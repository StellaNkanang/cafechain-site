// ── Live blockchain config ────────────────────────────────
const CONTRACT_ADDRESS = "0x19ed56C40EAb3a3a12a36447888Bb0D15bCc8771";

// CafeChain's contract lives on Sepolia testnet — the wallet must be on this
// chain or every contract read/write returns "0x" (BAD_DATA decode errors).
const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111
const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID,
  chainName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io']
};

// Make sure MetaMask is on Sepolia before we touch the contract; switch (or add)
// the network for the user instead of letting them hit a cryptic decode error.
async function ensureSepoliaNetwork() {
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId.toLowerCase() === SEPOLIA_CHAIN_ID) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID }]
    });
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [SEPOLIA_PARAMS]
      });
    } else {
      throw switchErr;
    }
  }
}

let provider = null;
let signer   = null;
let contract  = null;


// Meals are now loaded from the blockchain at runtime — see loadMealsFromChain().
let meals = [];

// COSMETIC ONLY. The chain stores name/price/stock; pictures live here, keyed by on-chain mealId.
// After you add a meal in the admin panel, note its new id and add an entry here to give it a picture.
const mealVisuals = {
  // 5: { emoji:'🍛', desc:'Your description here', img:'images/meal5.jpg' },
  // 6: { emoji:'🍲', desc:'Another meal',          img:'images/meal6.jpg' },
};
const DEFAULT_IMG = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80';

const ec = {'🍛':'#FF6B35','🍲':'#7B2D00','🫕':'#6D4C41','🥙':'#2D6A4F','🐟':'#264653','🍚':'#E6A817','🍽️':'#FF6B35'};

// Keeping your original tracking structure intact so your wallet operations don't break
const st = {sel:null,qty:1,tickets:[],blockNum:19482310,rev:0,user:{name:'',matric:'',wallet:'',balance:0}};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const randHex = n => '0x'+Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join('');


// ── RENDER MEALS ──
function renderMeals(){
  document.getElementById('mstack').innerHTML = meals.filter(m=>m.avail).map(m=>`
    <div class="mcard2" onclick="${m.stock > 0 ? `pickMeal(${m.id})` : 'void(0)'}" style="${m.stock <= 0 ? 'opacity:.45;pointer-events:none' : ''}">
      <img class="mcard2-img" src="${m.img}" alt="${m.name}">
      <div class="mcard2-body">
        <div class="mcard2-icon">${m.emoji}</div>
        <div class="mcard2-name">${m.name}</div>
        <div class="mcard2-desc">${m.desc}</div>
        <div class="mcard2-price">₦${m.priceNGN.toLocaleString()} · ${m.priceETH.toFixed(4)} ETH · ${m.stock} left</div>
      </div>
    </div>`).join('');
}

// ── NAVIGATION ──
function goTo(id){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  const el=document.getElementById(id);
  el.classList.add('on');
  el.scrollTop=0;
}
function navTo(key){
  document.querySelectorAll('#cnav .nbtn').forEach(b=>b.classList.remove('on'));
  const nb=document.getElementById('n-'+key);
  if(nb)nb.classList.add('on');
  if(key==='home')    loadMealsFromChain();      // re-read menu from chain
  if(key==='qrw')     loadTicketsFromChain();    // re-read tickets → catches admin redeems (#13)
  if(key==='history') loadTicketsFromChain();
  goTo('s-'+key);
}

// ── HERO CAROUSEL LOGIC ──
let heroOffset = 0;
function heroSlide(dir) {
  const c = document.getElementById('heroCarousel');
  if (!c) return;
  const slides = c.querySelectorAll('.hero-slide');
  heroOffset = Math.max(0, Math.min(slides.length - 1, heroOffset + dir));
  const w = slides[0].offsetWidth + 12; // calculates slide gap width
  
  c.style.transform = `translateX(-${heroOffset * w}px)`;
  c.style.transition = 'transform .3s ease';
  
  document.querySelectorAll('.hdot').forEach((d, i) => d.classList.toggle('on', i === heroOffset));
}
function heroGo(i) { 
  heroSlide(i - heroOffset); 
}

// ── LOGIN ──
function showStaffForm(show) {
  document.getElementById('lf-user').style.display  = show ? 'none' : '';
  document.getElementById('lf-admin').style.display = show ? '' : 'none';
  document.getElementById('staff-link').style.display = show ? 'none' : '';
}
async function userLogin() {
  const name = document.getElementById('lName').value.trim();
  const err = document.getElementById('lerr-u');

  if (!name) {
    err.textContent = 'Please enter your name.';
    return;
  }

  if (typeof window.ethereum === 'undefined') {
    err.textContent = 'Please install MetaMask from metamask.io';
    return;
  }

  try {
    err.textContent = 'Connecting to MetaMask…';

    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }]
    });
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });

    await ensureSepoliaNetwork();

    provider = new ethers.BrowserProvider(window.ethereum);
    signer   = await provider.getSigner();
    contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      window.CAFECHAIN_ABI,
      signer
    );

    const address    = accounts[0];
    const balanceWei = await provider.getBalance(address);
    const balanceETH = parseFloat(ethers.formatEther(balanceWei));

    err.textContent = '';
    st.user = { name, wallet: address, balance: balanceETH };

    // Remember the name for this wallet on THIS device (display convenience only)
    localStorage.setItem('cafechain_name_' + address.toLowerCase(), name);

    // Tickets come from the chain
    await loadTicketsFromChain();

    // 1. Update the student's name
    document.getElementById('hName').innerText = name;

    // 2. Update the wallet address
    document.getElementById('hWallet').innerText = address.slice(0, 8) + '…' + address.slice(-6);

    // 3. Update the ETH balance
    document.getElementById('hBal').innerText = balanceETH.toFixed(4) + ' ETH';

    document.getElementById('cnav').style.display = 'flex';
    document.getElementById('anav').classList.remove('on');
    navTo('home');   // navTo('home') also reloads the menu from the chain

  } catch (err2) {
    document.getElementById('lerr-u').textContent =
      err2.code === 4001 ? 'Cancelled. Please connect a wallet to continue.' : 'MetaMask error: ' + err2.message;
  }
}



// ── LOAD MEALS FROM CHAIN ──
async function loadMealsFromChain() {
  if (!contract) return;
  const next = [];
  const count = Number(await contract.mealCounter());
  for (let id = 1; id <= count; id++) {
    const m = await contract.getMeal(id);
    if (!m.exists) continue;                        // skip meals that don't exist
    let priceWei = 0n, priceETH = 0;
    try {
      priceWei = await contract.getRequiredWei(id);
      priceETH = parseFloat(ethers.formatEther(priceWei));
    } catch (e) { /* price feed hiccup — show ₦ only */ }
    const v = mealVisuals[id] || {};
    next.push({
      id,
      name:     m.name,
      priceNGN: Number(m.priceNGN),
      priceWei,                                     // BigInt, used at purchase
      priceETH,                                     // number, used for display
      stock:    Number(m.available),
      avail:    m.active,
      emoji:    v.emoji || '🍽️',
      desc:     v.desc  || m.name,
      img:      v.img   || DEFAULT_IMG
    });
  }
  meals = next;
  renderMeals();
}

// ── LOAD THIS WALLET'S TICKETS FROM CHAIN ──
async function loadTicketsFromChain() {
  if (!contract || !st.user.wallet) { st.tickets = []; renderHist(); renderQRW(); return; }
  const ids = await contract.getMyTickets(st.user.wallet);
  const arr = [];
  for (const idRaw of ids) {
    const id = Number(idRaw);
    const t  = await contract.getTicket(id);
    const meal = await contract.getMeal(Number(t.mealId));
    const v = mealVisuals[Number(t.mealId)] || {};
    const s = Number(t.status);                     // 0 Unused, 1 Used, 2 Expired, 3 Refunded
    let label = 'valid';
    if (s === 1) label = 'used';
    else if (s === 3) label = 'refunded';
    else if (s === 2 || Number(t.expiresAt) * 1000 < Date.now()) label = 'expired';
    arr.push({
      tokenId:   String(id),
      meal:      meal.name,
      emoji:     v.emoji || '🍽️',
      qty:       Number(t.quantity),
      amount:    parseFloat(ethers.formatEther(t.totalPaid)).toFixed(4),
      priceNGN:  Number(t.priceNGN),
      blockNum:  '—',
      hash:      'ticket-' + id,                     // placeholder; real QR payload comes with #3
      timestamp: new Date(Number(t.timestamp) * 1000),
      status:    label
    });
  }
  arr.sort((a, b) => Number(b.tokenId) - Number(a.tokenId));
  st.tickets = arr;
  renderHist();
  renderQRW();
}

async function adminLogin() {
  const err = document.getElementById('lerr-a');
  if (typeof window.ethereum === 'undefined') {
    err.textContent = 'Please install MetaMask from metamask.io';
    return;
  }
  try {
    err.textContent = 'Connecting to MetaMask…';
    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }]
    });
    const accounts  = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureSepoliaNetwork();
    const tempProv   = new ethers.BrowserProvider(window.ethereum);
    const readContract = new ethers.Contract(CONTRACT_ADDRESS, window.CAFECHAIN_ABI, tempProv);
    const ownerAddr  = await readContract.owner();
    if (accounts[0].toLowerCase() !== ownerAddr.toLowerCase()) {
      err.innerHTML = `
        <div style="background:#FFF8F0;border:1.5px solid #FFD599;border-radius:14px;padding:16px 14px;text-align:center">
          <div style="font-size:22px;margin-bottom:8px">🔐</div>
          <div style="font-size:13px;font-weight:900;color:#1A1A2E;margin-bottom:5px">Access Denied</div>
          <div style="font-size:11px;color:#8A8A9A;font-weight:700;line-height:1.7;margin-bottom:14px">
            This wallet is not the contract owner.<br>Open MetaMask, switch to the owner account, then try again.
          </div>
          <button onclick="adminLogin()" style="width:100%;padding:11px;background:linear-gradient(135deg,#1B2A4A,#243358);color:#fff;border:none;border-radius:11px;font-family:'Fredoka One',cursive;font-size:16px;cursor:pointer;letter-spacing:.3px">
            Try Again →
          </button>
        </div>`;
      return;
    }
    provider = tempProv;
    signer   = await provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, window.CAFECHAIN_ABI, signer);
    err.textContent = 'Loading admin panel…';
    const addr = accounts[0];
    await loadMealsFromChain();
    updAdmin();
    err.textContent = '';
    document.getElementById('adminWalletStatus').textContent = 'Connected: ' + addr.slice(0, 8) + '…' + addr.slice(-6);
    document.getElementById('cnav').style.display = 'none';
    document.getElementById('anav').classList.add('on');
    goTo('s-admin');
  } catch (e) {
    err.textContent = e.code === 4001 ? 'Cancelled. Select the owner wallet to continue.' : 'MetaMask error: ' + (e.message || e.reason);
  }
}
function userOut() {
  st.user = { name: '', wallet: '', balance: 0 };
  st.tickets = [];
  provider = null;
  signer   = null;
  contract = null;
  document.getElementById('cnav').style.display = 'none';
  document.getElementById('lName').value = '';
  goTo('s-login');
}
function adminOut() {
  stopScanner();
  provider = null;
  signer   = null;
  contract = null;
  document.getElementById('anav').classList.remove('on');
  showStaffForm(false);
  goTo('s-login');
}

// ── SWITCH USER ACCOUNT ──
async function applyUserAccount(address) {
  const savedName = localStorage.getItem('cafechain_name_' + address.toLowerCase());
  const name = savedName || st.user.name;

  provider = new ethers.BrowserProvider(window.ethereum);
  signer   = await provider.getSigner();
  contract = new ethers.Contract(CONTRACT_ADDRESS, window.CAFECHAIN_ABI, signer);

  const balanceWei = await provider.getBalance(address);
  const balanceETH = parseFloat(ethers.formatEther(balanceWei));

  st.user    = { name, wallet: address, balance: balanceETH };
  st.tickets = [];

  document.getElementById('hName').innerText   = name;
  document.getElementById('hWallet').innerText = address.slice(0, 8) + '…' + address.slice(-6);
  document.getElementById('hBal').innerText    = balanceETH.toFixed(4) + ' ETH';

  await loadTicketsFromChain();
  navTo('home');
}

async function switchUserAccount() {
  if (typeof window.ethereum === 'undefined' || !st.user.wallet) return;
  try {
    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }]
    });
  } catch (e) {
    if (e.code === 4001) return; // user dismissed
    // wallet_requestPermissions not supported — read the currently selected account below
  }
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const newAddress = accounts[0];
  if (!newAddress || newAddress.toLowerCase() === st.user.wallet.toLowerCase()) return;
  await applyUserAccount(newAddress);
}


// ── DETAIL ──
function pickMeal(id){
  st.sel = meals.find(m => m.id === id);
  if (!st.sel) return;                 // ignore clicks on meals not loaded (e.g. hero placeholders)
  st.qty = 1;
  document.getElementById('dimg').src=st.sel.img;
  document.getElementById('dname').textContent=st.sel.emoji+' '+st.sel.name;
  document.getElementById('ddesc').textContent=st.sel.desc;
  document.getElementById('dstock').textContent=st.sel.stock+' portions left';
  updPrices();
  document.querySelectorAll('#cnav .nbtn').forEach(b=>b.classList.remove('on'));
  goTo('s-detail');
}
function updPrices(){
  const m=st.sel,q=st.qty;
  const ngn=(m.priceNGN*q).toLocaleString();
  const eth=(m.priceETH*q).toFixed(4);
  document.getElementById('dprice').innerHTML=`₦${ngn} <span>· ${eth} ETH × ${q} portion${q>1?'s':''}</span>`;
  document.getElementById('iunit').textContent=`₦${m.priceNGN.toLocaleString()} · ${m.priceETH.toFixed(4)} ETH`;
  document.getElementById('itotal').textContent=`₦${ngn} · ${eth} ETH`;
  document.getElementById('btntotal').textContent=`₦${ngn}`;
}
function chgQ(d){st.qty=Math.max(1,Math.min(10,st.qty+d));document.getElementById('qnum').textContent=st.qty;updPrices();}

// ── PURCHASE ──
async function buy() {
  const m = st.sel, q = st.qty;

  if (!contract) { alert('Please log in again to reconnect your wallet.'); return; }

  // Live ETH price straight from the contract (Chainlink-based), in wei
  let totalWei, amt;
  try {
    const per = await contract.getRequiredWei(m.id);
    totalWei  = per * BigInt(q);
    amt       = parseFloat(ethers.formatEther(totalWei));
  } catch (e) {
    alert('Could not fetch the live price: ' + (e.reason || e.message));
    return;
  }

  if (st.user.balance < amt) {
    document.getElementById('fmbal').textContent = st.user.balance.toFixed(4) + ' ETH';
    document.getElementById('fmreq').textContent = amt.toFixed(4) + ' ETH';
    document.getElementById('fmsho').textContent = (amt - st.user.balance).toFixed(4) + ' ETH';
    document.getElementById('fmod').classList.add('on');
    return;
  }

  goTo('s-tx');
  document.getElementById('tktout').style.display = 'none';
  [1,2,3,4].forEach(i => {
    const x = document.getElementById('ti' + i);
    x.innerHTML = i; x.className = 'txi';
    document.getElementById('ts' + i).textContent = i === 1 ? 'Waiting…' : 'Pending…';
  });

  const sS = (i, s, t) => {
    const x = document.getElementById('ti' + i);
    x.className = 'txi ' + (s === 'ok' ? 'ok' : s === 'ld' ? 'ld' : '');
    x.innerHTML = s === 'ok' ? '✓' : s === 'ld' ? '<div class="spin"></div>' : i;
    document.getElementById('ts' + i).textContent = t;
  };

  try {
    // Step 1 — sign
    sS(1, 'ld', 'Opening MetaMask…');
    const tx = await contract.purchaseTicket(m.id, q, { value: totalWei });
    sS(1, 'ok', 'Signed ✓');

    // Step 2 — broadcast
    sS(2, 'ld', 'Broadcasting: ' + tx.hash.slice(0, 16) + '…');
    sS(2, 'ok', 'Sent to mempool ✓');

    // Step 3 — confirm
    sS(3, 'ld', 'Waiting for block confirmation…');
    const receipt = await tx.wait();
    sS(3, 'ok', 'Confirmed in block #' + receipt.blockNumber + ' ✓');

    // Step 4 — token ID
    sS(4, 'ld', 'Reading token ID…');
    const event   = receipt.logs
      .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
      .find(e => e && e.name === 'TicketPurchased');
    const tokenId = event ? event.args.ticketId.toString() : Math.floor(Math.random() * 9000 + 1000).toString();
    sS(4, 'ok', 'Token #' + tokenId + ' minted ✓');

    //Update balance shown in the header
    const newBal = await provider.getBalance(await signer.getAddress());
    st.user.balance = parseFloat(ethers.formatEther(newBal));

    // The real ticket now lives on-chain — refresh wallet/history from there
    loadTicketsFromChain();


    // Update UI
    document.getElementById('hBal').innerHTML = `<span style="font-size:14px">⟠</span> ` + st.user.balance.toFixed(4) + ' ETH';
document.getElementById('tid').textContent   = '#TKT-' + tokenId;
document.getElementById('tmeal').textContent = m.emoji + ' ' + m.name;
document.getElementById('tqty').textContent  = '× ' + q + ' serving' + (q > 1 ? 's' : '');
document.getElementById('tblock').textContent = receipt.blockNumber;
document.getElementById('thash').textContent  = tx.hash.slice(0, 12) + '…' + tx.hash.slice(-4);

// Real scannable QR encoding the on-chain ticket ID
renderTicketQR('qrMain', tokenId, 'valid', 110);
const dl = document.getElementById('dlQrBtn');
if (dl) dl.onclick = () => downloadQR(tokenId);
document.getElementById('tktout').style.display = 'block';

  } catch (err) {
    if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
      alert('You cancelled the transaction.');
    } else {
      alert('Transaction failed: ' + err.message);
    }
    navTo('home');
  }
}
function done(){ navTo('qrw'); }   // navTo('qrw') now reloads tickets from the chain

// ── QR ──
function drawQR(cid,data,size){
  const c=document.getElementById(cid); if(!c)return;
  c.width=size;c.height=size;
  const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,size,size); ctx.fillStyle='#111';
  const seed=data.split('').reduce((a,ch)=>a+ch.charCodeAt(0),0);
  const rng=s=>{let x=Math.sin(s)*10000;return x-Math.floor(x);};
  const cs=Math.floor(size/11);
  for(let r=0;r<11;r++)for(let cc=0;cc<11;cc++)if(rng(seed+r*100+cc)>0.45)ctx.fillRect(cc*cs,r*cs,cs,cs);
  [[0,0],[0,8],[8,0]].forEach(([r,cc])=>{ctx.fillStyle='#111';ctx.fillRect(cc*cs,r*cs,cs*3,cs*3);ctx.fillStyle='#fff';ctx.fillRect(cc*cs+cs*.4,r*cs+cs*.4,cs*2.2,cs*2.2);ctx.fillStyle='#111';ctx.fillRect(cc*cs+cs,r*cs+cs,cs,cs);});
}

// ── QR PAYLOAD — one format used by the receipt, the wallet, and (later) the scanner ──
function ticketQRData(id){ return 'CAFECHAIN-TKT:' + id; }

// ── RENDER A REAL, SCANNABLE QR INTO A CANVAS ──
function renderTicketQR(canvasId, ticketId, status, size){
  const c = document.getElementById(canvasId);
  if (!c) return;
  size = size || 110;
  const data = ticketQRData(ticketId);
  if (typeof QRCode === 'undefined' || !QRCode.toCanvas) {
    drawQR(canvasId, data, size);            // last-resort fallback (not scannable)
    return;
  }
  QRCode.toCanvas(c, data, { width: size, margin: 1 }, function(err){
    if (err) { drawQR(canvasId, data, size); return; }
    if (status && status !== 'valid') stampQR(c, status);   // mark spent tickets
  });
}

// ── GREY OUT + STAMP A SPENT TICKET'S QR ──
function stampQR(canvas, status){
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = status === 'used' ? '#C1440E' : '#8A8A9A';
  ctx.font = '900 ' + Math.round(canvas.width / 9) + 'px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 9);
  const label = status === 'used' ? 'TICKET USED'
              : status === 'expired' ? 'EXPIRED'
              : status === 'refunded' ? 'REFUNDED'
              : status.toUpperCase();
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

// ── DOWNLOAD A TICKET QR AS A HIGH-RES PNG (#14) ──
function downloadQR(ticketId){
  if (typeof QRCode === 'undefined' || !QRCode.toDataURL){
    alert('QR library not loaded — check your connection and reload the page.');
    return;
  }
  QRCode.toDataURL(ticketQRData(ticketId), { width: 512, margin: 2 }, function(err, url){
    if (err){ alert('Could not generate image: ' + err); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cafechain-ticket-' + ticketId + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// ── CLAIM REFUND ──
async function claimRefund(tokenId, btnEl) {
  if (!contract) { alert('Wallet not connected.'); return; }
  btnEl.disabled = true;
  btnEl.textContent = 'Submitting…';
  try {
    const tx = await contract.claimRefund(tokenId);
    btnEl.textContent = 'Confirming…';
    await tx.wait();
    await loadTicketsFromChain();
  } catch (e) {
    btnEl.disabled = false;
    btnEl.textContent = '↩ Claim Refund';
    alert('Refund failed: ' + (e.reason || e.message));
  }
}

// ── HISTORY ──
function renderHist(){
  const n=st.tickets.length;
  document.getElementById('histsub').textContent=n?n+' purchase'+(n>1?'s':''):'No purchases yet';
  document.getElementById('histcontent').innerHTML=n?`<div class="hlist">${st.tickets.map(t=>`
    <div class="hi">
      <div class="hiemo" style="background:${ec[t.emoji]||'#FF6B35'}22">${t.emoji}</div>
      <div class="hiinfo"><div class="hiname">${t.meal}</div><div class="hidate">${t.timestamp.toLocaleDateString()} · ${t.timestamp.toLocaleTimeString()}</div><div class="hihash">${t.hash.slice(0,20)}…</div></div>
      <div class="hiright"><div class="hiprice">${t.amount} ETH</div><span class="hibadge ${{valid:'bv',used:'bu',expired:'be',refunded:'br'}[t.status]||'bu'}">${{valid:'✓ Valid',used:'Used',expired:'Expired',refunded:'Refunded'}[t.status]||t.status}</span>${t.status==='expired'?`<button class="hibadge" style="margin-top:5px;background:#E65100;color:#fff;border:none;cursor:pointer;display:block;width:100%;padding:3px 8px" onclick="claimRefund(${t.tokenId},this)">↩ Refund</button>`:''}</div>
    </div>`).join('')}</div>`
    :`<div class="empty"><div class="eico">🛒</div><div class="etitle">No tickets yet!</div><div class="esub">Buy your first meal to see history here</div></div>`;
}

// ── QR WALLET ──
function renderQRW(){
  const n=st.tickets.length,v=st.tickets.filter(t=>t.status==='valid').length;
  document.getElementById('qrwsub').textContent=v?v+' active ticket'+(v>1?'s':''):'No active tickets';
  document.getElementById('qrwcontent').innerHTML=n?`<div class="qlist">${st.tickets.map((t,i)=>`
    <div class="qi ${t.status!=='valid'?t.status:''}">
      <div class="qitop"><div class="qiname">${t.emoji} ${t.meal}</div><div class="qipill">${{valid:'✓ Valid',used:'Used',expired:'Expired',refunded:'Refunded'}[t.status]||t.status}</div></div>
      <div class="qiqty">${t.qty} portion${t.qty>1?'s':''} · Block #${t.blockNum}</div>
      <div class="qiqr"><canvas id="qc${i}" width="110" height="110"></canvas></div>
      <div class="qimeta">Ticket #${t.tokenId}</div>
      ${t.status==='valid'?`<button class="refundbtn" onclick="downloadQR(${t.tokenId})">⬇ Download QR</button>`:''}
      ${t.status==='expired'?`<button class="refundbtn" onclick="claimRefund(${t.tokenId},this)">↩ Claim Refund</button>`:''}
    </div>`).join('')}</div>`
    :`<div class="empty"><div class="eico">🎟️</div><div class="etitle">No tickets yet!</div><div class="esub">Your QR codes will appear here after purchase</div></div>`;
  setTimeout(()=>st.tickets.forEach((t,i)=>renderTicketQR('qc'+i,t.tokenId,t.status,110)),50);
}

// ── ADMIN ──


async function updAdmin(){
  if (contract) {
    try {
      const sold   = Number(await contract.ticketCounter());
      const balWei = await contract.getContractBalance();
      document.getElementById('as1').textContent = sold;
      document.getElementById('as2').textContent = parseFloat(ethers.formatEther(balWei)).toFixed(3);
      document.getElementById('as3').textContent = sold;
    } catch (e) { /* not connected yet */ }
  }
  document.getElementById('as4').textContent = meals.filter(m=>m.avail).length;
  renderAdminList();
  loadAllTickets();
}

// ── REDEEM TICKET (Admin only) ──
async function redeemTicket() {
  const ticketId = parseInt(document.getElementById('redeemId').value);
  const msg = document.getElementById('redeemMsg');

  if (!ticketId || ticketId < 1) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Please enter a valid ticket ID.';
    return;
  }

  if (!contract) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'No contract connected. Please log in as a student first to initialise the contract, then switch to admin.';
    return;
  }

  if (!(await precheckTicket(ticketId))) return;

  try {
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Sending transaction…';

    const tx = await contract.redeemTicket(ticketId);
    msg.textContent = 'Waiting for confirmation…';

    await tx.wait();

    showRedeemSuccess('✓', 'Ticket #' + ticketId + ' marked as used on-chain!');

    // Also mark it as used in local state so QR Wallet updates
    const t = st.tickets.find(t => t.tokenId === String(ticketId));
    if (t) { t.status = 'used'; renderQRW(); }

    document.getElementById('redeemId').value = '';

    // Refresh the All-Tickets list so the redeemed ticket flips to "Used"
    loadAllTickets();

  } catch (err) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Failed: ' + (err.reason || err.message);
  }
}

// ════════════════════════════════════════════════
//  ADMIN QR SCANNER — live camera + image upload
//  Decodes CAFECHAIN-TKT:<id>, checks status, redeems
// ════════════════════════════════════════════════
let html5Qr = null;

// Pull the numeric ticket id out of a scanned QR string
function parseTicketPayload(text){
  if (!text) return null;
  const t = String(text).trim();
  const m = t.match(/CAFECHAIN-TKT:(\d+)/i);
  if (m) return parseInt(m[1]);
  if (/^\d+$/.test(t)) return parseInt(t);   // tolerate a bare number
  return null;
}

// Toggle button: starts the camera if it's off, stops it if it's already running.
// (Calling start() while a stream is already open is what left the camera light
// stuck on — html5-qrcode throws, the preview gets hidden, but the stream never stops.)
async function toggleScanner(){
  if (html5Qr && html5Qr.isScanning){ await stopScanner(); return; }
  await startScanner();
}

// Start the live camera scanner
async function startScanner(){
  const msg = document.getElementById('redeemMsg');
  if (html5Qr && html5Qr.isScanning) return;   // already running — never call start() twice
  if (!contract){ msg.style.color='var(--red)'; msg.textContent='Connect your admin wallet first.'; return; }
  if (typeof Html5Qrcode === 'undefined'){ msg.style.color='var(--red)'; msg.textContent='Scanner library not loaded — check your connection and reload.'; return; }

  document.getElementById('scanWrap').style.display = 'block';
  if (!html5Qr) html5Qr = new Html5Qrcode('qrReader');
  const cfg = { fps: 10, qrbox: 220 };

  try {
    // Prefer the rear camera (phones / tablets)
    await html5Qr.start({ facingMode: 'environment' }, cfg, onScanSuccess, () => {});
  } catch (e) {
    // Fallback for laptops/desktops: just use the first camera found
    try {
      const cams = await Html5Qrcode.getCameras();
      if (!cams || !cams.length) throw e;
      await html5Qr.start(cams[0].id, cfg, onScanSuccess, () => {});
    } catch (e2) {
      msg.style.color = 'var(--red)';
      msg.textContent = 'Camera unavailable: ' + (e2.message || e2) + ' — needs HTTPS/localhost + camera permission.';
      document.getElementById('scanWrap').style.display = 'none';
      return;
    }
  }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Point the camera at a ticket QR…';
  setScanBtnState(true);
}

// Stop the camera
async function stopScanner(){
  if (html5Qr && html5Qr.isScanning){
    try { await html5Qr.stop(); } catch (e) {}
  }
  const w = document.getElementById('scanWrap');
  if (w) w.style.display = 'none';
  setScanBtnState(false);
}

// Keep the single visible button in sync with the camera so it always reads
// "Stop Camera" while live — the user shouldn't have to hunt for a stop control.
function setScanBtnState(scanning){
  const btn = document.getElementById('scanBtn');
  if (!btn) return;
  if (scanning){
    btn.dataset.origBg = btn.dataset.origBg || btn.style.background;
    btn.textContent = '✕ Stop Camera';
    btn.style.background = '#555';
  } else {
    btn.textContent = '📷 Scan QR with Camera';
    btn.style.background = btn.dataset.origBg || '';
  }
}

// Decode a QR from an uploaded image (no camera needed)
async function scanFromFile(input){
  const msg = document.getElementById('redeemMsg');
  if (!input.files || !input.files.length) return;
  if (!contract){ msg.style.color='var(--red)'; msg.textContent='Connect your admin wallet first.'; return; }
  await stopScanner();
  if (!html5Qr) html5Qr = new Html5Qrcode('qrReader');
  try {
    const decoded = await html5Qr.scanFile(input.files[0], false);
    await onScanSuccess(decoded);
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'No QR code found in that image.';
  }
  input.value = '';   // allow re-selecting the same file
}

// Rejection/success cards auto-dismiss after this long so they don't linger
// once the staff member has clearly seen them.
let redeemCardTimer = null;
function autoDismissRedeemCard(){
  clearTimeout(redeemCardTimer);
  redeemCardTimer = setTimeout(() => {
    const msg = document.getElementById('redeemMsg');
    if (msg) msg.innerHTML = '';
  }, 3000);
}

// Big, hard-to-miss rejection card — staff need to notice a bad scan at a glance
function showRedeemAlert(icon, text){
  const msg = document.getElementById('redeemMsg');
  msg.style.color = '';
  msg.innerHTML = `<div class="redalert"><div class="ra-ic">${icon}</div><div class="ra-tx">${text}</div></div>`;
  autoDismissRedeemCard();
}

// Equally hard-to-miss confirmation card for a successful redemption
function showRedeemSuccess(icon, text){
  const msg = document.getElementById('redeemMsg');
  msg.style.color = '';
  msg.innerHTML = `<div class="grnalert"><div class="ra-ic">${icon}</div><div class="ra-tx">${text}</div></div>`;
  autoDismissRedeemCard();
}

// FREE on-chain pre-check shared by the scanner and the manual-ID form →
// instant rejection card for spent/expired/missing tickets, no wallet popup.
// Returns true when the ticket is still redeemable.
async function precheckTicket(id){
  try {
    const t = await contract.getTicket(id);
    if (t.buyer === '0x0000000000000000000000000000000000000000'){
      showRedeemAlert('❓', 'Ticket #' + id + ' does not exist'); return false;
    }
    const s = Number(t.status);                 // 0 Unused, 1 Used, 2 Expired, 3 Refunded
    if (t.isUsed || s === 1){ showRedeemAlert('🚫', 'Ticket #' + id + ' — ALREADY USED'); return false; }
    if (s === 3){ showRedeemAlert('↩️', 'Ticket #' + id + ' — ALREADY REFUNDED'); return false; }
    if (Number(t.expiresAt) * 1000 < Date.now()){ showRedeemAlert('⏰', 'Ticket #' + id + ' — EXPIRED'); return false; }
  } catch (e) { /* read failed — let redeemTicket() surface the real error */ }
  return true;
}

// Shared handler: decode → check on-chain → redeem
async function onScanSuccess(decodedText){
  await stopScanner();
  const msg = document.getElementById('redeemMsg');
  const id  = parseTicketPayload(decodedText);
  if (!id){ msg.style.color='var(--red)'; msg.textContent='Unrecognised QR code.'; return; }

  if (!(await precheckTicket(id))) return;

  // Valid → reuse your existing redeem flow (sends the tx, shows the ✓ confirmation)
  document.getElementById('redeemId').value = id;
  redeemTicket();
}

function renderAdminList(){
  document.getElementById('adminList').innerHTML = meals.map(m=>`
    <div class="mrow">
      <div class="mico" style="background:${ec[m.emoji]||'#FF6B35'}22">${m.emoji}</div>
      <div class="minfo"><div class="mname">${m.name}</div><div class="mprice">₦${m.priceNGN.toLocaleString()} · ${m.priceETH.toFixed(4)} ETH · ${m.stock} left</div></div>
      <button class="tog ${m.avail?'on':'off'}" onclick="togMeal(${m.id})"></button>
    </div>`).join('');
}

// ════════════════════════════════════════════════
//  ADMIN: ALL TICKETS HISTORY  (#5 — unused + used)
// ════════════════════════════════════════════════
let adminTickets = [];
let adminFilter  = 'all';

async function loadAllTickets(){
  const box = document.getElementById('adminTx');
  if (!contract){
    box.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-weight:700;font-size:13px">Connect your admin wallet to see tickets.</div>';
    return;
  }
  box.innerHTML = '<div style="text-align:center;padding:18px;color:var(--muted);font-weight:700;font-size:13px">Loading tickets from chain…</div>';

  const total = Number(await contract.ticketCounter());
  const arr = [];
  for (let id = total; id >= 1; id--){            // newest first
    let t;
    try { t = await contract.getTicket(id); } catch (e) { continue; }
    if (t.buyer === '0x0000000000000000000000000000000000000000') continue;
    const mealObj = meals.find(x => x.id === Number(t.mealId));   // reuse cached names
    const v = mealVisuals[Number(t.mealId)] || {};
    const s = Number(t.status);                   // 0 Unused, 1 Used, 2 Expired, 3 Refunded
    let label = 'valid';
    if (s === 1) label = 'used';
    else if (s === 3) label = 'refunded';
    else if (s === 2 || Number(t.expiresAt) * 1000 < Date.now()) label = 'expired';
    arr.push({
      id,
      buyer:     t.buyer,
      meal:      mealObj ? mealObj.name : ('Meal #' + Number(t.mealId)),
      emoji:     v.emoji || '🍽️',
      qty:       Number(t.quantity),
      amount:    parseFloat(ethers.formatEther(t.totalPaid)).toFixed(4),
      priceNGN:  Number(t.priceNGN),
      timestamp: new Date(Number(t.timestamp) * 1000),
      status:    label
    });
  }
  adminTickets = arr;
  renderAdminTickets();
}

function setAdminFilter(f){ adminFilter = f; renderAdminTickets(); }

function renderAdminTickets(){
  const box = document.getElementById('adminTx');
  const all = adminTickets;
  const nValid = all.filter(t => t.status === 'valid').length;
  const nUsed  = all.filter(t => t.status === 'used').length;

  const f = adminFilter;
  const list = all.filter(t =>
    f === 'valid' ? t.status === 'valid' :
    f === 'used'  ? t.status === 'used'  :
    true
  );

  const tabs = `<div class="atabs">
      <button class="atab ${f==='all'?'on':''}"   onclick="setAdminFilter('all')">All (${all.length})</button>
      <button class="atab ${f==='valid'?'on':''}" onclick="setAdminFilter('valid')">Unused (${nValid})</button>
      <button class="atab ${f==='used'?'on':''}"  onclick="setAdminFilter('used')">Used (${nUsed})</button>
    </div>`;

  const badgeClass = { valid:'bv', used:'bu', expired:'be', refunded:'br' };
  const badgeText  = { valid:'✓ Unused', used:'Used', expired:'Expired', refunded:'Refunded' };

  const rows = list.length ? list.map(t => `
    <div style="background:#fff;border-radius:12px;padding:11px 13px;box-shadow:0 2px 10px rgba(0,0,0,.05)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-weight:800;font-size:clamp(11px,3.2vw,14px)">${t.emoji} ${t.meal} <span style="color:var(--muted);font-weight:700">#${t.id}</span></span>
        <span class="hibadge ${badgeClass[t.status]}">${badgeText[t.status]}</span>
      </div>
      <div style="font-size:clamp(9px,2.5vw,11px);color:var(--muted);font-weight:700">${t.qty} portion${t.qty>1?'s':''} · ₦${(t.priceNGN*t.qty).toLocaleString()} · ${t.amount} ETH · ${t.timestamp.toLocaleDateString()} ${t.timestamp.toLocaleTimeString()}</div>
      <div style="font-family:monospace;font-size:clamp(8px,2.2vw,10px);color:#bbb;margin-top:2px">buyer ${t.buyer.slice(0,10)}…${t.buyer.slice(-6)}</div>
    </div>`).join('')
    : `<div style="text-align:center;padding:18px;color:var(--muted);font-weight:700;font-size:13px">No tickets in this view.</div>`;

  box.innerHTML = tabs + rows;
}

let _toggling = false;
async function togMeal(id) {
  if (_toggling) return;
  if (!contract) { alert('Connect your admin wallet first to toggle meals on-chain.'); return; }
  const m = meals.find(m => m.id === id);
  if (!m) return;
  _toggling = true;
  try {
    const tx = m.avail
      ? await contract.deactivateMeal(id)
      : await contract.reactivateMeal(id);
    await tx.wait();
    await loadMealsFromChain();
    renderAdminList();
  } catch (e) {
    alert('Transaction failed: ' + (e.reason || e.message));
  }
  _toggling = false;
}

// ── ADD MEAL ──
function pickEmoji(el){document.querySelectorAll('.eopt').forEach(e=>e.classList.remove('on'));el.classList.add('on');}
const mImgs=['https://images.unsplash.com/photo-1547592180-85f173990554?w=600&q=80','https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80','https://images.unsplash.com/photo-1476224203421-9ac39bcb3df1?w=600&q=80','https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80'];
const mCols=['c0','c1','c2','c3','c4','c5'];

async function addMeal(){
  const name = document.getElementById('fName').value.trim();
  const priceNGN = parseInt(document.getElementById('fPrice').value);   // ₦ whole number, e.g. 2000
  const stock = parseInt(document.getElementById('fStock').value);
  const ok = document.getElementById('amok');

  if(!name || !priceNGN || !stock){ ok.style.color='var(--red)'; ok.textContent='Please fill name, price (₦) and stock.'; return; }
  if(!contract){ ok.style.color='var(--red)'; ok.textContent='Connect your admin wallet first.'; return; }

  try {
    ok.style.color='var(--muted)'; ok.textContent='Sending transaction…';
    const tx = await contract.addMeal(name, priceNGN, stock);
    ok.textContent='Waiting for confirmation…';
    await tx.wait();
    ok.style.color='var(--success)'; ok.textContent='✓ Meal added on-chain!';
    ['fName','fDesc','fPrice','fStock'].forEach(x=>document.getElementById(x).value='');
    await loadMealsFromChain();
    updAdmin();
    setTimeout(()=>ok.textContent='',4000);
  } catch (e) {
    ok.style.color='var(--red)'; ok.textContent='Failed: ' + (e.reason || e.message);
  }
}

// ── METAMASK ACCOUNT CHANGE LISTENER ──
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.ethereum === 'undefined') return;

  // MetaMask's recommended pattern: reload on network switch so a stale
  // provider/contract pointing at the wrong chain can't cause decode errors.
  window.ethereum.on('chainChanged', () => window.location.reload());

  window.ethereum.on('accountsChanged', async (accounts) => {
    // User disconnected all accounts in MetaMask
    if (accounts.length === 0) {
      if (document.getElementById('anav').classList.contains('on')) {
        adminOut();
      } else if (st.user.wallet) {
        userOut();
      }
      return;
    }

    const newAccount = accounts[0];

    // Student session: different account switched in → update session seamlessly
    if (st.user.wallet && st.user.wallet.toLowerCase() !== newAccount.toLowerCase()) {
      await applyUserAccount(newAccount);
      return;
    }

    // Admin session: verify the new account is still the contract owner
    if (document.getElementById('anav').classList.contains('on')) {
      try {
        const tempProv = new ethers.BrowserProvider(window.ethereum);
        const readContract = new ethers.Contract(CONTRACT_ADDRESS, window.CAFECHAIN_ABI, tempProv);
        const ownerAddr = await readContract.owner();
        if (newAccount.toLowerCase() !== ownerAddr.toLowerCase()) {
          adminOut();
          showStaffForm(true);
          document.getElementById('lerr-a').textContent =
            'MetaMask switched to a non-owner account. Please reconnect with the owner wallet.';
        } else {
          // Same owner, just update the session to the new account
          provider = tempProv;
          signer   = await provider.getSigner();
          contract = new ethers.Contract(CONTRACT_ADDRESS, window.CAFECHAIN_ABI, signer);
          document.getElementById('adminWalletStatus').textContent =
            'Connected: ' + newAccount.slice(0, 8) + '…' + newAccount.slice(-6);
        }
      } catch (e) {
        adminOut();
      }
    }
  });
});
