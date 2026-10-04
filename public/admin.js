const API = "https://flowwultra.online/api";

let token = localStorage.getItem("dsflow_admin_token");
let users = [];
let editingUserId = null;


/* ---------- HELPERS ---------- */

const $ = (id) => document.getElementById(id);

function showMessage(id, message, error = false) {
  const el = $(id);
  if (!el) return;

  el.textContent = message;
  el.style.color = error ? "#ff7777" : "#65e2ae";
}

function toast(message, error = false) {
  const el = $("toast");

  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", error);

  setTimeout(() => {
    el.classList.add("hidden");
  }, 3000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


async function api(path, options = {}) {

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed (${response.status})`
    );
  }

  return data;
}


/* ---------- LOGIN ---------- */

$("loginBtn").addEventListener("click", login);

$("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});


async function login() {

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email || !password) {
    showMessage(
      "loginMessage",
      "Email and password required.",
      true
    );
    return;
  }

  $("loginBtn").disabled = true;
  showMessage("loginMessage", "Logging in...");

  try {

    const data = await api("/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password
      })
    });

    token = data.token;

    localStorage.setItem(
      "dsflow_admin_token",
      token
    );

    showAdmin();

    toast("Login successful.");

  } catch (error) {

    showMessage(
      "loginMessage",
      error.message,
      true
    );

  } finally {

    $("loginBtn").disabled = false;

  }
}


/* ---------- LOGOUT ---------- */

$("logoutBtn").addEventListener("click", () => {

  token = null;

  localStorage.removeItem(
    "dsflow_admin_token"
  );

  $("adminPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");

});


/* ---------- SHOW ADMIN ---------- */

function showAdmin() {

  $("loginPage").classList.add("hidden");
  $("adminPage").classList.remove("hidden");

  checkHealth();
  loadUsers();
  loadLogs();

}


/* ---------- API HEALTH ---------- */

async function checkHealth() {

  const el = $("apiStatus");

  try {

    const data = await fetch(
      API + "/health"
    ).then(r => r.json());

    if (data.ok) {

      el.textContent = "API Online";
      el.classList.remove("bad");

    } else {

      throw new Error();

    }

  } catch {

    el.textContent = "API Offline";
    el.classList.add("bad");

  }
}


/* ---------- SERVER SELECTION ---------- */

$("allServers").addEventListener("change", () => {

  const checked = $("allServers").checked;

  document
    .querySelectorAll(".serverBox")
    .forEach(box => {
      box.checked = checked;
    });

});


function getSelectedServers(selector = ".serverBox") {

  return [...document.querySelectorAll(selector)]
    .filter(box => box.checked)
    .map(box => Number(box.value));

}


/* ---------- CREATE USER ---------- */

$("createUserBtn").addEventListener(
  "click",
  createUser
);


async function createUser() {

  const email = $("newEmail").value.trim();
  const password = $("newPassword").value;
  const expires = $("newExpiry").value;
  const maxDevices = Number(
    $("newDevices").value || 1
  );

  const servers = getSelectedServers();

  if (!email || !password) {

    showMessage(
      "createMessage",
      "Email and password required.",
      true
    );

    return;

  }

  if (!expires) {

    showMessage(
      "createMessage",
      "Select subscription expiry.",
      true
    );

    return;

  }

  if (!servers.length) {

    showMessage(
      "createMessage",
      "Select at least one server.",
      true
    );

    return;

  }

  $("createUserBtn").disabled = true;

  try {

    await api("/admin/users", {

      method: "POST",

      body: JSON.stringify({

        email,
        password,

        subscription_expires:
          new Date(expires).toISOString(),

        max_devices: maxDevices,

        servers

      })

    });

    showMessage(
      "createMessage",
      "User created successfully."
    );

    $("newEmail").value = "";
    $("newPassword").value = "";
    $("newExpiry").value = "";
    $("newDevices").value = "1";

    $("allServers").checked = false;

    document
      .querySelectorAll(".serverBox")
      .forEach(box => {
        box.checked = false;
      });

    await loadUsers();

    toast("User created.");

  } catch (error) {

    showMessage(
      "createMessage",
      error.message,
      true
    );

  } finally {

    $("createUserBtn").disabled = false;

  }

}


/* ---------- LOAD USERS ---------- */

async function loadUsers() {

  try {

    const data = await api(
      "/admin/users"
    );

    users = Array.isArray(data)
      ? data
      : data.users || [];

    renderUsers();

  } catch (error) {

    $("usersTable").innerHTML = `
      <tr>
        <td colspan="7">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;

    if (
      error.message.toLowerCase().includes("token") ||
      error.message.toLowerCase().includes("session")
    ) {
      logoutExpired();
    }

  }

}


function logoutExpired() {

  token = null;

  localStorage.removeItem(
    "dsflow_admin_token"
  );

  $("adminPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");

  showMessage(
    "loginMessage",
    "Session expired. Login again.",
    true
  );

}


/* ---------- RENDER USERS ---------- */

function renderUsers() {

  const search =
    $("searchBox").value
      .trim()
      .toLowerCase();

  const filtered = users.filter(user =>
    String(user.email || "")
      .toLowerCase()
      .includes(search)
  );

  $("totalUsers").textContent =
    users.length;

  $("activeUsers").textContent =
    users.filter(u => u.status === "active").length;

  $("blockedUsers").textContent =
    users.filter(u => u.status === "blocked").length;

  $("expiredUsers").textContent =
    users.filter(u => {

      if (!u.subscription_expires) {
        return false;
      }

      return new Date(
        u.subscription_expires
      ) <= new Date();

    }).length;


  if (!filtered.length) {

    $("usersTable").innerHTML = `
      <tr>
        <td colspan="7">
          No users found.
        </td>
      </tr>
    `;

    return;

  }


  $("usersTable").innerHTML =
    filtered.map(user => {

      const expired =
        user.subscription_expires &&
        new Date(user.subscription_expires)
          <= new Date();

      const statusClass =
        user.status === "blocked"
          ? "blocked"
          : expired
            ? "expired"
            : "status";

      const statusText =
        user.status === "blocked"
          ? "Blocked"
          : expired
            ? "Expired"
            : "Active";

      const servers =
        Array.isArray(user.servers)
          ? user.servers.join(", ")
          : "—";

      return `

        <tr>

          <td>${escapeHtml(user.id)}</td>

          <td>${escapeHtml(user.email)}</td>

          <td>
            <span class="${statusClass}">
              ${statusText}
            </span>
          </td>

          <td>
            ${formatDate(user.subscription_expires)}
          </td>

          <td>
            ${escapeHtml(user.device_count ?? 0)}
            /
            ${escapeHtml(user.max_devices ?? 1)}
          </td>

          <td>
            ${escapeHtml(servers)}
          </td>

          <td>

            <div class="actions">

              <button
                class="small-btn blue"
                onclick="openEdit(${user.id})">
                Edit
              </button>

              <button
                class="small-btn yellow"
                onclick="clearDevices(${user.id})">
                Clear
              </button>

              ${
                user.status === "blocked"
                ?
                `<button
                  class="small-btn green"
                  onclick="setStatus(${user.id}, 'active')">
                  Unblock
                </button>`
                :
                `<button
                  class="small-btn red"
                  onclick="setStatus(${user.id}, 'blocked')">
                  Block
                </button>`
              }

            </div>

          </td>

        </tr>

      `;

    }).join("");

}


function formatDate(value) {

  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();

}


/* ---------- SEARCH ---------- */

$("searchBox").addEventListener(
  "input",
  renderUsers
);


/* ---------- REFRESH ---------- */

$("refreshBtn").addEventListener(
  "click",
  async () => {

    await loadUsers();
    await checkHealth();

    toast("Refreshed.");

  }
);


/* ---------- CLEAR DEVICES ---------- */

async function clearDevices(id) {

  if (
    !confirm(
      "Clear all devices for this user?"
    )
  ) {
    return;
  }

  try {

    await api(
      `/admin/users/${id}/clear-devices`,
      {
        method: "POST"
      }
    );

    toast("Devices cleared.");

    await loadUsers();

  } catch (error) {

    toast(
      error.message,
      true
    );

  }

}


/* ---------- BLOCK / UNBLOCK ---------- */

async function setStatus(id, status) {

  try {

    await api(
      `/admin/users/${id}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status
        })
      }
    );

    toast(
      status === "blocked"
        ? "User blocked."
        : "User unblocked."
    );

    await loadUsers();

  } catch (error) {

    toast(
      error.message,
      true
    );

  }

}


/* ---------- EDIT USER ---------- */

function openEdit(id) {

  const user =
    users.find(u => Number(u.id) === Number(id));

  if (!user) {
    return;
  }

  editingUserId = id;

  $("editUserEmail").textContent =
    user.email;

  $("editDevices").value =
    user.max_devices || 1;

  $("editStatus").value =
    user.status || "active";

  if (user.subscription_expires) {

    const date =
      new Date(user.subscription_expires);

    const local =
      new Date(
        date.getTime() -
        date.getTimezoneOffset() * 60000
      )
      .toISOString()
      .slice(0, 16);

    $("editExpiry").value = local;

  } else {

    $("editExpiry").value = "";

  }


  const servers =
    Array.isArray(user.servers)
      ? user.servers.map(Number)
      : [];

  document
    .querySelectorAll(".editServerBox")
    .forEach(box => {

      box.checked =
        servers.includes(
          Number(box.value)
        );

    });


  $("editModal")
    .classList.remove("hidden");

}


$("closeModal").addEventListener(
  "click",
  closeEdit
);

$("cancelEditBtn").addEventListener(
  "click",
  closeEdit
);


function closeEdit() {

  editingUserId = null;

  $("editModal")
    .classList.add("hidden");

}


/* ---------- SAVE EDIT ---------- */

$("saveEditBtn").addEventListener(
  "click",
  saveEdit
);


async function saveEdit() {

  if (!editingUserId) {
    return;
  }

  const expires =
    $("editExpiry").value;

  const servers =
    getSelectedServers(".editServerBox");

  try {

    await api(
      `/admin/users/${editingUserId}`,
      {
        method: "PATCH",

        body: JSON.stringify({

          subscription_expires:
            expires
              ? new Date(expires).toISOString()
              : null,

          max_devices:
            Number(
              $("editDevices").value || 1
            ),

          status:
            $("editStatus").value,

          servers

        })

      }
    );

    toast("User updated.");

    closeEdit();

    await loadUsers();

  } catch (error) {

    toast(
      error.message,
      true
    );

  }

}


/* ---------- LOGS ---------- */

$("logsBtn").addEventListener(
  "click",
  loadLogs
);


async function loadLogs() {

  try {

    const data = await api(
      "/admin/logs"
    );

    const logs =
      Array.isArray(data)
        ? data
        : data.logs || [];

    if (!logs.length) {

      $("logsTable").innerHTML = `
        <tr>
          <td colspan="5">
            No logs found.
          </td>
        </tr>
      `;

      return;

    }


    $("logsTable").innerHTML =
      logs.map(log => `

        <tr>

          <td>
            ${escapeHtml(log.id)}
          </td>

          <td>
            ${escapeHtml(log.actor || "")}
          </td>

          <td>
            ${escapeHtml(log.action || "")}
          </td>

          <td>
            ${escapeHtml(
              typeof log.details === "object"
                ? JSON.stringify(log.details)
                : log.details || ""
            )}
          </td>

          <td>
            ${formatDate(log.created_at)}
          </td>

        </tr>

      `).join("");

  } catch (error) {

    $("logsTable").innerHTML = `
      <tr>
        <td colspan="5">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;

  }

}


/* ---------- START ---------- */

if (token) {
  showAdmin();
} else {
  $("loginPage")
    .classList.remove("hidden");
}
