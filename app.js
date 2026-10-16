const CONTRACT_ADDRESS = "0x98F044c4771BC95537BD6Cae8b058f47bb050B83";

const CONTRACT_ABI = [
  {
    "inputs": [],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Deposited",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "checkBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const NETWORKS = {1:"Ethereum Mainnet",11155111:"Sepolia",17000:"Holesky",5:"Goerli",1337:"Local",31337:"Hardhat"};

let web3, bank, account, subs = [];
let pendingBulk = null;
let transactionInProgress = false;
const $ = id => document.getElementById(id);

function log(msg, type = "info") {
  const li = document.createElement("li");
  li.className = type;
  li.textContent = `[${new Date().toLocaleTimeString("th-TH")}] ${msg}`;
  $("log").prepend(li);
}

function errText(e) {
  if (e && e.code === 4001) return "ยกเลิกรายการในกระเป๋า";
  return ((e && e.message) || String(e)).split("\n")[0];
}

function setButtons(enabled) {
  document.querySelectorAll(".act").forEach(b => (b.disabled = !enabled));
}

function readAmountWei() {
  const v = $("amount").value.trim();
  if (!v || isNaN(v) || Number(v) <= 0) throw new Error("กรอกจำนวน ETH ที่มากกว่า 0");
  return web3.utils.toWei(v, "ether");
}

const short = a => a.slice(0, 6) + "..." + a.slice(-4);

async function updateWallet() {
  $("accountText").textContent = short(account);
  const chainId = Number(await web3.eth.getChainId());
  $("networkText").textContent = NETWORKS[chainId] || "Chain " + chainId;
  const wei = await web3.eth.getBalance(account);
  $("walletText").textContent = Number(web3.utils.fromWei(wei, "ether")).toFixed(4) + " ETH";
}

async function checkBalance() {
  try {
    const wei = await bank.methods.checkBalance().call({ from: account });
    $("vaultBalance").textContent = web3.utils.fromWei(wei, "ether");
  } catch (e) {
    log("ตรวจสอบยอดไม่สำเร็จ: " + errText(e), "error");
  }
}

async function transact(label, buildTx, extra, amountWei) {
  try {
    const wei = amountWei || readAmountWei();
    transactionInProgress = true;
    setButtons(false);
    log(`${label}: รอยืนยันในกระเป๋า...`);
    const rc = await buildTx(wei).send({ from: account, ...extra(wei) });
    log(`${label}สำเร็จ (tx ${short(rc.transactionHash)})`, "ok");
    $("amount").value = "";
    await checkBalance();
    await updateWallet();
  } catch (e) {
    log(`${label}ไม่สำเร็จ: ${errText(e)}`, "error");
  } finally {
    transactionInProgress = false;
    setButtons(!!account);
  }
}

const deposit = () => transact("ฝาก", () => bank.methods.deposit(), wei => ({ value: wei }));
const withdraw = () => transact("ถอน", wei => bank.methods.withdraw(wei), () => ({}));

async function prepareWithdrawAll() {
  if (!account || !bank) return;
  const owner = account;
  setButtons(false);

  try {
    const wei = await bank.methods.checkBalance().call({ from: owner });
    if (new web3.utils.BN(wei).isZero()) {
      throw new Error("ไม่มียอด ETH ใน BankBoo ให้ถอน");
    }

    if (account !== owner) throw new Error("บัญชีกระเป๋าเปลี่ยนระหว่างเตรียมรายการ กรุณาลองอีกครั้ง");

    pendingBulk = {
      label: "ถอนทั้งหมด",
      wei,
      buildTx: amount => bank.methods.withdraw(amount),
      extra: () => ({})
    };
    $("confirmTitle").textContent = "ถอนยอดทั้งหมด?";
    $("confirmMessage").textContent =
      "ระบบจะถอนยอด ETH ทั้งหมดที่ฝากไว้ใน BankBoo เข้ากระเป๋าที่เชื่อมต่อ ตรวจสอบจำนวนแล้วกดยืนยันอีกครั้งเพื่อส่งรายการ";
    $("confirmAmount").textContent = web3.utils.fromWei(wei, "ether");
    $("confirmAllBtn").textContent = "ยืนยันถอนทั้งหมด";
    $("confirmDialog").showModal();
  } catch (e) {
    pendingBulk = null;
    log(`ถอนทั้งหมดไม่สำเร็จ: ${errText(e)}`, "error");
    setButtons(!!account);
  }
}

function confirmAllTransaction() {
  if (!pendingBulk) return;
  const { label, wei, buildTx, extra } = pendingBulk;
  pendingBulk = null;
  $("confirmDialog").close();
  transact(label, buildTx, extra, wei);
}

function listenEvents() {
  subs.forEach(s => s.unsubscribe && s.unsubscribe());
  subs = [];
  try {
    const opts = { filter: { account }, fromBlock: "latest" };
    subs.push(bank.events.Deposited(opts).on("data", e =>
      log(`Event Deposited: ${web3.utils.fromWei(e.returnValues.amount, "ether")} ETH`, "info")));
    subs.push(bank.events.Withdrawn(opts).on("data", e =>
      log(`Event Withdrawn: ${web3.utils.fromWei(e.returnValues.amount, "ether")} ETH`, "info")));
  } catch (e) {
    log("เปิดการดักฟัง event ไม่ได้: " + errText(e), "error");
  }
}

async function connect() {
  if (!window.ethereum) {
    log("ไม่พบ MetaMask กรุณาติดตั้งส่วนขยายแล้วโหลดหน้านี้ใหม่", "error");
    return;
  }
  try {
    web3 = new Web3(window.ethereum);
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = accs[0];

    const code = await web3.eth.getCode(CONTRACT_ADDRESS).catch(() => "0x");
    if (!code || code === "0x") {
      log("ไม่พบ Contract ที่ address นี้ ตรวจสอบ CONTRACT_ADDRESS และเครือข่ายใน MetaMask", "error");
      await updateWallet();
      return;
    }
    bank = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    await updateWallet();
    await checkBalance();
    listenEvents();
    setButtons(true);
    $("connectBtn").textContent = "เชื่อมต่อแล้ว";
    log("เชื่อมต่อ MetaMask และ Contract สำเร็จ", "ok");
  } catch (e) {
    log("เชื่อมต่อไม่สำเร็จ: " + errText(e), "error");
  }
}

if (window.ethereum) {
  window.ethereum.on("accountsChanged", async accs => {
    if (!accs.length) {
      account = null; setButtons(false);
      pendingBulk = null;
      if ($("confirmDialog").open) $("confirmDialog").close();
      $("accountText").textContent = "ยังไม่เชื่อมต่อ";
      $("vaultBalance").textContent = "-";
      $("connectBtn").textContent = "เชื่อมต่อ MetaMask";
      log("ตัดการเชื่อมต่อกระเป๋า", "info");
      return;
    }
    account = accs[0];
    pendingBulk = null;
    if ($("confirmDialog").open) $("confirmDialog").close();
    log("เปลี่ยนบัญชีเป็น " + short(account), "info");
    await updateWallet();
    if (bank) { await checkBalance(); listenEvents(); }
  });
  window.ethereum.on("chainChanged", () => location.reload());
}

$("connectBtn").addEventListener("click", connect);
$("depositBtn").addEventListener("click", deposit);
$("withdrawBtn").addEventListener("click", withdraw);
$("withdrawAllBtn").addEventListener("click", prepareWithdrawAll);
$("confirmAllBtn").addEventListener("click", confirmAllTransaction);
$("cancelAllBtn").addEventListener("click", () => $("confirmDialog").close());
$("confirmDialog").addEventListener("close", () => {
  if (pendingBulk) {
    log(`ยกเลิก${pendingBulk.label}`, "info");
    pendingBulk = null;
  }
  if (!transactionInProgress) setButtons(!!account);
});
$("checkBtn").addEventListener("click", checkBalance);
