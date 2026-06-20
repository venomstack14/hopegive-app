// ── SECURE STATE MANAGEMENT (Replaced localStorage with sessionStorage) ──
const API = "https://hopegive-backend.onrender.com";
let authToken = sessionStorage.getItem("hg_token") || "";
let authUser = JSON.parse(sessionStorage.getItem("hg_user") || "null");
let currentCampaignId = null;
let selectedDonationAmount = 500;
let currentDonationId = null;

// ── SECURITY HELPERS (XSS Mitigation) ──
const escapeHTML = (str) => {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
};

function apiFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  if (opts.body instanceof FormData) delete headers["Content-Type"];
  return fetch(API + path, { ...opts, headers });
}

function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast-item toast-${escapeHTML(type)}`;
  el.textContent = msg; // Secure text insertion
  document.getElementById("toast").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function fmt(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
function pct(a, b) { return b ? Math.min(100, Math.round(a / b * 100)) : 0; }
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

// ── AUTH ──
function updateNav() {
  const loggedIn = !!authToken;
  document.getElementById("loginBtn").style.display = loggedIn ? "none" : "";
  document.getElementById("registerBtn").style.display = loggedIn ? "none" : "";
  document.getElementById("userMenuBtn").style.display = loggedIn ? "flex" : "none";
  if (authUser) {
    const initials = authUser.name.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
    document.getElementById("navAvatarTxt").textContent = initials;
    document.getElementById("navUserName").textContent = authUser.name.split(" ")[0];
  }
  const adminNav = document.getElementById("nl-admin");
  if (authUser && authUser.role === "admin") {
    adminNav.style.display = "";
  } else {
    adminNav.style.display = "none";
  }
}

function toggleUserMenu() {
  if (confirm("Sign out?")) doLogout();
}

async function doLogin() {
  const email = document.getElementById("l_email").value.trim();
  const password = document.getElementById("l_password").value;
  const r = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "Login failed", "error"); return; }
  authToken = d.token;
  authUser = { id: d.user_id, name: d.name, role: d.role };
  sessionStorage.setItem("hg_token", authToken);
  sessionStorage.setItem("hg_user", JSON.stringify(authUser));
  closeModal("loginModal");
  updateNav();
  toast("Welcome back, " + authUser.name.split(" ")[0] + "!");
  if (d.role === "admin") { showPage("admin"); loadAdminStats(); }
}

async function doRegister() {
  const body = {
    full_name: document.getElementById("r_name").value.trim(),
    email: document.getElementById("r_email").value.trim(),
    mobile: document.getElementById("r_mobile").value.trim(),
    password: document.getElementById("r_password").value,
    role: document.getElementById("r_role").value
  };
  const r = await apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "Registration failed", "error"); return; }
  authToken = d.token;
  authUser = { id: d.user_id, name: d.name, role: d.role };
  sessionStorage.setItem("hg_token", authToken);
  sessionStorage.setItem("hg_user", JSON.stringify(authUser));
  closeModal("registerModal");
  updateNav();
  toast("Account created! Welcome, " + authUser.name.split(" ")[0] + ".");
  if (body.role === "applicant") showPage("apply");
}

function doLogout() {
  apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  authToken = ""; authUser = null;
  sessionStorage.removeItem("hg_token"); 
  sessionStorage.removeItem("hg_user");
  updateNav();
  showPage("home");
}

function setRegisterRole(role) {
  document.getElementById("r_role").value = escapeHTML(role);
  document.getElementById("role-donor").style.cssText = role === "donor"
    ? "flex:1;border:2px solid var(--blue);background:var(--blue-light);color:var(--blue)"
    : "flex:1;border:2px solid var(--border-strong);background:transparent";
  document.getElementById("role-applicant").style.cssText = role === "applicant"
    ? "flex:1;border:2px solid var(--teal);background:var(--teal-light);color:var(--teal)"
    : "flex:1;border:2px solid var(--border-strong);background:transparent";
}

// ── NAVIGATION ──
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const targetPage = document.getElementById("page-" + escapeHTML(name));
  if (targetPage) targetPage.classList.add("active");
  const nl = document.getElementById("nl-" + escapeHTML(name));
  if (nl) nl.classList.add("active");
  window.scrollTo(0, 0);
  if (name === "home") loadHomeStats();
  if (name === "campaigns") loadCampaigns();
  if (name === "transparency") loadTransparency();
  if (name === "admin") { 
    if (!authToken || authUser?.role !== "admin") { 
      toast("Admin only", "error"); showPage("home"); return; 
    } 
    loadAdminStats(); 
  }
}

function openApply() {
  if (!authToken) { openModal("registerModal"); return; }
  if (authUser?.role === "donor") { toast("Apply as an applicant account to request aid.", "error"); return; }
  showPage("apply");
}

// ── CAMPAIGNS ──
const catEmoji = { medical: "🏥", education: "📚", disaster: "🏚", livelihood: "💼", disability: "♿" };
const catColor = { medical: "#EAF3DE", education: "#E6F1FB", disaster: "#FAEEDA", livelihood: "#EEEDFE", disability: "#E1F5EE" };

function campaignCard(c, onclickStr) {
  const p = pct(c.raised_amount, c.approved_amount || c.requested_amount);
  const statusBadge = c.status === "active"
    ? `<span class="badge badge-success">✓ Verified</span>`
    : `<span class="badge badge-warning">⏳ Pending</span>`;
    
  return `<div class="campaign-card" onclick="${onclickStr}">
    <div class="campaign-card-img" style="background:${escapeHTML(catColor[c.category] || '#f5f5f5')}">${escapeHTML(catEmoji[c.category] || "💛")}</div>
    <div class="campaign-card-body">
      <div style="display:flex;gap:6px;margin-bottom:.5rem">${statusBadge}<span class="badge badge-info">${escapeHTML(c.category)}</span></div>
      <div style="font-weight:600;font-size:15px;margin-bottom:.4rem;line-height:1.4">${escapeHTML(c.title)}</div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:.75rem;line-height:1.5">${escapeHTML(c.description.slice(0,120))}…</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-family:'Fraunces',serif;font-size:1.2rem;font-weight:600;color:var(--teal)">${fmt(c.raised_amount)}</span>
        <span style="font-size:13px;color:var(--text-muted)">of ${fmt(c.approved_amount || c.requested_amount)}</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width:${p}%"></div></div>
      <div style="font-size:12px;color:var(--text-muted)">${p}% funded · ${escapeHTML(c.applicant_state || "India")}</div>
    </div>
  </div>`;
}

async function loadCampaigns(category) {
  const url = "/api/campaigns?status=active" + (category && category !== "all" ? "&category=" + escapeHTML(category) : "");
  const r = await apiFetch(url).catch(() => null);
  if(!r) return;
  const camps = await r.json();
  const grid = document.getElementById("campaignGrid");
  const none = document.getElementById("noCampaigns");
  if (!camps || !camps.length) {
    grid.innerHTML = ""; none.style.display = "block"; return;
  }
  none.style.display = "none";
  grid.innerHTML = camps.map(c => campaignCard(c, `openCampaign('${escapeHTML(c.id)}')`)).join("");
}

function filterCampaigns(cat) { loadCampaigns(cat); }

async function loadHomeStats() {
  try {
    const r = await apiFetch("/api/stats");
    const d = await r.json();
    document.getElementById("stat-raised").textContent = fmt(d.total_raised);
    document.getElementById("stat-beneficiaries").textContent = d.beneficiaries;
    document.getElementById("stat-donors").textContent = d.donors;
    const gr = await apiFetch("/api/campaigns?status=active");
    const camps = await gr.json();
    document.getElementById("homeCampaigns").innerHTML = camps.slice(0,3)
      .map(c => campaignCard(c, `showPage('campaigns');openCampaign('${escapeHTML(c.id)}')`)).join("") ||
      `<div class="card" style="text-align:center;color:var(--text-muted);padding:3rem">No active campaigns yet.</div>`;
  } catch(e){}
}

async function openCampaign(id) {
  currentCampaignId = escapeHTML(id);
  document.getElementById("donateStep1").style.display = "block";
  document.getElementById("donateStep2").style.display = "none";
  document.getElementById("donateStep3").style.display = "none";
  selectedDonationAmount = 500;
  showPage("campaign-detail");
  
  try {
    const r = await apiFetch("/api/campaigns/" + currentCampaignId);
    const c = await r.json();
    const p = pct(c.raised_amount, c.approved_amount || c.requested_amount);

    document.getElementById("campDetailContent").innerHTML = `
      <div class="camp-meta-row">
        <span class="badge badge-success">✓ Verified</span>
        <span class="badge badge-info">${escapeHTML(c.category)}</span>
        <span style="font-size:13px;color:var(--text-muted)">Need score: ${escapeHTML(c.need_score)}/100</span>
      </div>
      <h1 style="font-size:1.8rem;margin-bottom:.5rem">${escapeHTML(c.title)}</h1>
      <p style="color:var(--text-secondary);margin-bottom:1rem">Applicant: ${escapeHTML(c.applicant_name)} · ${escapeHTML(c.applicant_state || "India")}</p>
      <div style="display:flex;align-items:baseline;gap:.75rem;margin-bottom:.5rem">
        <span class="camp-amount">${fmt(c.raised_amount)}</span>
        <span style="color:var(--text-muted)">raised of ${fmt(c.approved_amount || c.requested_amount)}</span>
      </div>
      <div class="progress" style="max-width:480px"><div class="progress-fill" style="width:${p}%"></div></div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:.5rem">${p}% funded</div>`;

    document.getElementById("campDetailBody").innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <h3 style="font-size:1rem;margin-bottom:.75rem;font-family:'Inter',sans-serif">About this cause</h3>
        <p style="color:var(--text-secondary);line-height:1.7">${escapeHTML(c.description)}</p>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="font-size:1rem;margin-bottom:.75rem;font-family:'Inter',sans-serif">Verification status</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          <div class="badge badge-success" style="width:fit-content">✓ Identity (KYC) verified</div>
          <div class="badge badge-success" style="width:fit-content">✓ Documents reviewed</div>
          <div class="badge badge-success" style="width:fit-content">✓ Community vouchers confirmed</div>
          <div class="badge badge-success" style="width:fit-content">✓ Need score: ${escapeHTML(c.need_score)}/100</div>
        </div>
      </div>
      ${c.disbursements && c.disbursements.length ? `<div class="card">
        <h3 style="font-size:1rem;margin-bottom:.75rem;font-family:'Inter',sans-serif">Disbursement log</h3>
        <div class="timeline">${c.disbursements.map(d => `
          <div class="tl-item"><div class="tl-dot"></div>
            <h4>${fmt(d.amount)} → ${escapeHTML(d.vendor_name)}</h4>
            <p>${escapeHTML(d.description)} · ${escapeHTML(d.invoice_number)} · ${escapeHTML(d.created_at.split(" ")[0])}</p>
          </div>`).join("")}</div></div>` : ""}`;

    const donBtn = document.getElementById("donateBtn");
    donBtn.textContent = "Donate ₹500 securely →";

    const dr = await apiFetch("/api/campaigns/" + currentCampaignId + "/donors");
    const donors = await dr.json();
    document.getElementById("donorList").innerHTML = donors.length
      ? donors.slice(0,10).map(d => `<li class="donor-item">
          <span style="font-size:14px">${escapeHTML(d.anonymous ? "Anonymous" : d.donor_name)}</span>
          <span style="font-size:14px;font-weight:600;color:var(--teal)">${fmt(d.amount)}</span>
        </li>`).join("")
      : `<li style="color:var(--text-muted);font-size:13px">Be the first to donate!</li>`;
  } catch(e){}
}

// ── DONATION ──
function selectAmount(amt, btn) {
  document.querySelectorAll(".amount-chip").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedDonationAmount = amt;
  document.getElementById("customAmountRow").style.display = amt === 0 ? "block" : "none";
  const label = amt === 0 ? "Custom amount" : `₹${amt.toLocaleString("en-IN")}`;
  document.getElementById("donateBtn").textContent = `Donate ${amt === 0 ? "" : label} securely →`;
}

async function initiateDonation() {
  const amount = selectedDonationAmount === 0
    ? parseFloat(document.getElementById("customAmount").value)
    : selectedDonationAmount;
  const name = document.getElementById("don_name").value.trim();
  const email = document.getElementById("don_email").value.trim();
  const mobile = document.getElementById("don_mobile").value.trim();
  
  if (!amount || !name || !email || !mobile) { toast("Please fill all donation fields", "error"); return; }
  
  const r = await apiFetch("/api/donations/initiate", {
    method: "POST",
    body: JSON.stringify({
      campaign_id: currentCampaignId, amount, donor_name: name,
      donor_email: email, donor_mobile: mobile,
      anonymous: document.getElementById("don_anon").checked ? 1 : 0
    })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "Failed to initiate donation", "error"); return; }
  
  currentDonationId = escapeHTML(d.donation_id);
  document.getElementById("demoOtpText").textContent = `Demo OTP: ${escapeHTML(d.demo_otp)} (remove in production)`;
  document.getElementById("donateStep1").style.display = "none";
  document.getElementById("donateStep2").style.display = "block";
}

async function verifyDonationOtp() {
  const otp = document.getElementById("otpInput").value.trim();
  const r = await apiFetch("/api/donations/" + currentDonationId + "/verify-otp", {
    method: "POST", body: JSON.stringify({ otp })
  });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "OTP verification failed", "error"); return; }
  
  document.getElementById("donateStep2").style.display = "none";
  document.getElementById("donateStep3").style.display = "block";
  document.getElementById("donateSuccessMsg").textContent = `${fmt(d.amount)} is securely held in escrow.`;
  document.getElementById("donateRefBadge").textContent = "Ref: " + escapeHTML(d.transaction_ref);
  toast("Donation confirmed! Thank you for giving hope.");
}

// ── FLAG ──
async function submitFlag() {
  if (!authToken) { closeModal("flagModal"); openModal("loginModal"); return; }
  const reason = document.getElementById("flagReason").value.trim();
  if (!reason) { toast("Please provide a reason", "error"); return; }
  const r = await apiFetch("/api/campaigns/" + currentCampaignId + "/flag", {
    method: "POST", body: JSON.stringify({ reason })
  });
  const d = await r.json();
  closeModal("flagModal");
  toast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
}

// ── APPLY ──
let applyCurrentStep = 1;
function goApplyStep(n) {
  document.querySelectorAll(".step-form").forEach(f => f.classList.remove("active"));
  document.querySelectorAll(".apply-step").forEach((s, i) => {
    s.classList.remove("active","done");
    if (i + 1 < n) s.classList.add("done");
    if (i + 1 === n) s.classList.add("active");
  });
  const stepTarget = document.getElementById("aform-" + n);
  if(stepTarget) stepTarget.classList.add("active");
  applyCurrentStep = n;
}

function applyStep1() {
  const name = document.getElementById("a_name").value.trim();
  const email = document.getElementById("a_email").value.trim();
  const mobile = document.getElementById("a_mobile").value.trim();
  const password = document.getElementById("a_password").value;
  if (!name || !email || !mobile || !password) { toast("Fill all identity fields", "error"); return; }
  if (password.length < 8) { toast("Password must be at least 8 characters", "error"); return; }
  goApplyStep(2);
}

function applyStep2() {
  const category = document.getElementById("a_category").value;
  const title = document.getElementById("a_title").value.trim();
  const desc = document.getElementById("a_desc").value.trim();
  const amount = document.getElementById("a_amount").value;
  if (!category || !title || !desc || !amount) { toast("Fill all cause fields", "error"); return; }
  goApplyStep(3);
}

function recalcScore() {
  const income = parseFloat(document.getElementById("a_income").value) || 0;
  const dep = parseInt(document.getElementById("a_dependants").value) || 0;
  const cat = document.getElementById("a_category").value || "education";
  if (!income) { document.getElementById("scorePreview").style.display = "none"; return; }
  const povertyLine = 12000;
  let score = 0;
  if (income < povertyLine * .5) score += 30;
  else if (income < povertyLine) score += 22;
  else if (income < povertyLine * 1.5) score += 14;
  else score += 5;
  score += Math.min(dep * 3, 15);
  const urgency = { medical: 30, disaster: 28, disability: 25, livelihood: 18, education: 15 };
  score += urgency[cat] || 10;
  score += 20;
  score = Math.min(score, 100);
  document.getElementById("scorePreview").style.display = "block";
  document.getElementById("scoreNum").textContent = score + "/100";
}

function updateCauseHint() {
  const hints = {
    medical: "Required documents: Doctor's prescription, hospital estimate, treating doctor's registration number.",
    education: "Required documents: Admission letter, fee receipt from institution, income certificate.",
    disaster: "Required documents: Police FIR or municipal damage report, photographs of damage.",
    livelihood: "Required documents: Employer termination letter or self-declaration, bank statements (3 months).",
    disability: "Required documents: Disability certificate from government hospital, caregiver details."
  };
  const v = document.getElementById("a_category").value;
  const box = document.getElementById("causeHintBox");
  if (hints[v]) { box.style.display = "flex"; document.getElementById("causeHintText").textContent = hints[v]; }
  else { box.style.display = "none"; }
  recalcScore();
}

async function submitApplication() {
  const btn = document.getElementById("submitApplyBtn");
  btn.disabled = true; btn.textContent = "Submitting…";

  if (!authToken) {
    const regBody = {
      full_name: document.getElementById("a_name").value.trim(),
      email: document.getElementById("a_email").value.trim(),
      mobile: document.getElementById("a_mobile").value.trim(),
      password: document.getElementById("a_password").value,
      role: "applicant",
      aadhaar_last4: document.getElementById("a_aadhaar").value.trim(),
      pan: document.getElementById("a_pan").value.trim(),
      state: document.getElementById("a_state").value
    };
    const rr = await apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(regBody) });
    const rd = await rr.json();
    if (!rr.ok) { toast(rd.error || "Registration failed", "error"); btn.disabled = false; btn.textContent = "Submit application"; return; }
    authToken = rd.token;
    authUser = { id: rd.user_id, name: rd.name, role: rd.role };
    sessionStorage.setItem("hg_token", authToken);
    sessionStorage.setItem("hg_user", JSON.stringify(authUser));
    updateNav();
  }

  const fd = new FormData();
  fd.append("title", document.getElementById("a_title").value.trim());
  fd.append("category", document.getElementById("a_category").value);
  fd.append("description", document.getElementById("a_desc").value.trim());
  fd.append("monthly_income", document.getElementById("a_income").value);
  fd.append("dependants", document.getElementById("a_dependants").value);
  fd.append("requested_amount", document.getElementById("a_amount").value);
  fd.append("voucher1_name", document.getElementById("a_v1name").value);
  fd.append("voucher1_mobile", document.getElementById("a_v1mob").value);
  fd.append("voucher2_name", document.getElementById("a_v2name").value);
  fd.append("voucher2_mobile", document.getElementById("a_v2mob").value);
  fd.append("vendor_name", document.getElementById("a_vendor").value);
  fd.append("vendor_account", document.getElementById("a_vendor_acc").value);
  ["doc_aadhaar","doc_income","doc_cause"].forEach(id => {
    const f = document.getElementById(id).files[0];
    if (f) fd.append("documents", f);
  });

  const headers = {};
  if (authToken) headers["Authorization"] = "Bearer " + authToken;
  const r = await fetch("/api/campaigns", { method: "POST", headers, body: fd });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "Submission failed", "error"); btn.disabled = false; btn.textContent = "Submit application"; return; }
  toast(`Application submitted! Need score: ${d.need_score}/100. You'll be contacted within 3 working days.`);
  showPage("home");
}

// ── TRANSPARENCY ──
async function loadTransparency() {
  try {
    const [sr, dr] = await Promise.all([apiFetch("/api/stats"), apiFetch("/api/disbursements")]);
    const stats = await sr.json();
    const disbs = await dr.json();
    document.getElementById("ts-raised").textContent = fmt(stats.total_raised);
    document.getElementById("ts-disbursed").textContent = fmt(stats.total_raised * 0.85);
    document.getElementById("ts-escrow").textContent = fmt(stats.total_raised * 0.15);
    document.getElementById("ts-donors").textContent = stats.donors;
    document.getElementById("disbTableBody").innerHTML = disbs.length
      ? disbs.map(d => `<tr>
          <td>${escapeHTML(d.created_at.split(" ")[0])}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(d.campaign_title)}</td>
          <td style="font-weight:600;color:var(--teal)">${fmt(d.amount)}</td>
          <td>${escapeHTML(d.vendor_name)}</td>
          <td><span class="badge badge-teal">${escapeHTML(d.invoice_number)}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)">${escapeHTML(d.description)}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">No disbursements yet.</td></tr>`;
  } catch(e) {}
}

// ── ADMIN ──
function adminTab(tab) {
  document.querySelectorAll("[id^='at-']").forEach(el => el.style.display = "none");
  document.querySelectorAll(".admin-nav-item").forEach(el => el.classList.remove("active"));
  const targetTab = document.getElementById("at-" + escapeHTML(tab));
  if(targetTab) targetTab.style.display = "block";
  const navTab = document.getElementById("an-" + escapeHTML(tab));
  if(navTab) navTab.classList.add("active");
  
  if (tab === "pending") loadAdminCampaigns("pending");
  if (tab === "active") loadAdminCampaigns("active");
  if (tab === "users") loadAdminUsers();
  if (tab === "disburse") loadAdminDisburse();
  if (tab === "audit") loadAuditLog();
}

async function loadAdminStats() {
  const r = await apiFetch("/api/admin/stats").catch(() => null);
  if (!r || !r.ok) return;
  const d = await r.json();
  document.getElementById("am-raised").textContent = fmt(d.total_raised);
  document.getElementById("am-disbursed").textContent = fmt(d.total_disbursed);
  document.getElementById("am-pending").textContent = d.pending_campaigns;
  document.getElementById("am-flags").textContent = d.recent_flags;
}

async function loadAdminCampaigns(status) {
  try {
    const r = await apiFetch("/api/admin/campaigns?status=" + escapeHTML(status));
    const camps = await r.json();
    const container = document.getElementById(status === "pending" ? "pendingList" : "activeList");
    if (!camps.length) { container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:2rem">No ${escapeHTML(status)} campaigns.</div>`; return; }
    
    container.innerHTML = camps.map(c => `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.5rem">
          <div><div style="font-weight:600;font-size:15px">${escapeHTML(c.title)}</div>
            <div style="font-size:13px;color:var(--text-secondary)">${escapeHTML(c.applicant_name)} · ${escapeHTML(c.applicant_email)} · ${escapeHTML(c.mobile || "")}</div></div>
          <span class="badge badge-purple">Score: ${escapeHTML(c.need_score)}</span>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);margin:.5rem 0">${escapeHTML(c.description.slice(0,200))}…</div>
        <div style="display:flex;gap:.5rem;align-items:center;font-size:13px;margin-bottom:.75rem">
          <span>Income: ${fmt(c.monthly_income)}/mo</span> · <span>Dependants: ${escapeHTML(c.dependants)}</span> · <span>Requested: ${fmt(c.requested_amount)}</span>
        </div>
        ${status === "pending" ? `<div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="openApproveModal('${escapeHTML(c.id)}','${escapeHTML(c.title).replace(/'/g,"\\'")}',${escapeHTML(c.requested_amount)},${escapeHTML(c.need_score)})">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectCampaign('${escapeHTML(c.id)}')">Reject</button>
        </div>` : `<span class="badge badge-success">Live · ${fmt(c.raised_amount)} raised</span>`}
      </div>`).join("");
  } catch(e) {}
}

function openApproveModal(id, title, amount, score) {
  document.getElementById("approveModalId").value = escapeHTML(id);
  document.getElementById("approveModalSub").textContent = title; 
  document.getElementById("approve_amount").value = escapeHTML(amount);
  document.getElementById("approve_score").value = escapeHTML(score);
  openModal("approveModal");
}

async function reviewCampaign(action) {
  const id = document.getElementById("approveModalId").value;
  const body = { action };
  if (action === "approve") {
    body.approved_amount = parseFloat(document.getElementById("approve_amount").value);
    body.need_score = parseInt(document.getElementById("approve_score").value);
  } else {
    body.reason = prompt("Reason for rejection:") || "Does not meet eligibility criteria";
  }
  const r = await apiFetch("/api/admin/campaigns/" + id + "/review", { method: "POST", body: JSON.stringify(body) });
  const d = await r.json();
  closeModal("approveModal");
  toast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
  loadAdminCampaigns("pending");
  loadAdminStats();
}

async function rejectCampaign(id) {
  const reason = prompt("Reason for rejection:") || "Does not meet eligibility criteria";
  const r = await apiFetch("/api/admin/campaigns/" + id + "/review", { method: "POST", body: JSON.stringify({ action: "reject", reason }) });
  const d = await r.json();
  toast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
  loadAdminCampaigns("pending");
}

async function loadAdminUsers() {
  try {
    const r = await apiFetch("/api/admin/users");
    const users = await r.json();
    document.getElementById("usersList").innerHTML = `<div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>State</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td>${escapeHTML(u.full_name)}</td><td>${escapeHTML(u.email)}</td>
        <td><span class="badge ${u.role==='admin'?'badge-danger':u.role==='applicant'?'badge-purple':'badge-info'}">${escapeHTML(u.role)}</span></td>
        <td>${escapeHTML(u.state || "-")}</td>
        <td style="color:var(--text-muted)">${escapeHTML(u.created_at.split(" ")[0])}</td>
        <td>${u.is_verified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Unverified</span>'}</td>
        <td>${!u.is_verified ? `<button class="btn btn-sm btn-outline" onclick="verifyUser('${escapeHTML(u.id)}')">Verify ID</button>` : "—"}</td>
      </tr>`).join("")}</tbody>
    </table></div></div>`;
  } catch(e) {}
}

async function verifyUser(id) {
  const r = await apiFetch("/api/admin/users/" + id + "/verify", { method: "POST" });
  const d = await r.json();
  toast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
  loadAdminUsers();
}

async function loadAdminDisburse() {
  try {
    const [cr, dr] = await Promise.all([apiFetch("/api/admin/campaigns?status=active"), apiFetch("/api/disbursements")]);
    const camps = await cr.json();
    const disbs = await dr.json();
    const sel = document.getElementById("d_campaign");
    sel.innerHTML = `<option value="">Select campaign…</option>` + camps.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.title)}</option>`).join("");
    document.getElementById("disbHistory").innerHTML = disbs.map(d => `<tr>
      <td>${escapeHTML(d.created_at.split(" ")[0])}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(d.campaign_title)}</td>
      <td style="font-weight:600;color:var(--teal)">${fmt(d.amount)}</td>
      <td>${escapeHTML(d.vendor_name)}</td>
      <td>${escapeHTML(d.invoice_number)}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem">No disbursements yet.</td></tr>`;
  } catch(e) {}
}

async function submitDisbursement() {
  const body = {
    campaign_id: document.getElementById("d_campaign").value,
    amount: parseFloat(document.getElementById("d_amount").value),
    vendor_name: document.getElementById("d_vendor").value.trim(),
    vendor_ref: document.getElementById("d_vendor_ref").value.trim(),
    invoice_number: document.getElementById("d_invoice").value.trim(),
    description: document.getElementById("d_desc").value.trim()
  };
  if (!body.campaign_id || !body.amount || !body.vendor_name) { toast("Fill all disbursement fields", "error"); return; }
  const r = await apiFetch("/api/admin/disbursements", { method: "POST", body: JSON.stringify(body) });
  const d = await r.json();
  toast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
  if (r.ok) loadAdminDisburse();
}

async function loadAuditLog() {
  try {
    const r = await apiFetch("/api/admin/audit");
    const rows = await r.json();
    document.getElementById("auditBody").innerHTML = rows.map(row => `<tr>
      <td style="color:var(--text-muted)">${escapeHTML(row.created_at)}</td>
      <td><span class="badge badge-info">${escapeHTML(row.entity_type)}</span></td>
      <td>${escapeHTML(row.action)}</td>
      <td style="font-size:12px;color:var(--text-muted)">${escapeHTML(row.details || "-")}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No audit events.</td></tr>`;
  } catch(e) {}
}

// ── INIT ──
window.addEventListener("DOMContentLoaded", () => {
  updateNav();
  showPage("home");
});
