import { initMatrixEffect } from "./matrix.js";
import { clearSessionToken, getSessionToken, setSessionToken, toPage } from "./runtime-config.js";

const DB_SESSION = "chaotic_session";
const DB_REMEMBER = "chaotic_remember";

const hashPassword = (pass) => btoa(pass).split("").reverse().join("");

initMatrixEffect();

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

async function apiJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const viewLogin = document.getElementById("view-login");
  const viewRegister = document.getElementById("view-register");
  const viewVerify = document.getElementById("view-verify");
  const overlay = document.getElementById("loading-overlay");

  let verificationData = null; // { username, tribe }

  const switchView = (viewToShow) => {
    [viewLogin, viewRegister, viewVerify].forEach((view) => {
      view.classList.remove("active");
    });
    viewToShow.classList.add("active");
  };

  const withLoading = async (fn, minTime = 700) => {
    overlay.classList.remove("hidden");
    const start = Date.now();
    try {
      await fn();
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < minTime) {
        await new Promise((resolve) => setTimeout(resolve, minTime - elapsed));
      }
      overlay.classList.add("hidden");
    }
  };

  async function verifyCookieSessionAndRedirect() {
    try {
      const data = await apiJsonWithTimeout("/api/auth/session", { method: "GET" }, 8000);
      if (data?.ok && data?.username) {
        localStorage.setItem(
          DB_SESSION,
          JSON.stringify({
            username: String(data.username),
            sessionToken: getSessionToken(),
            token: Date.now(),
          })
        );
        window.location.href = toPage("menu.html");
      }
    } catch (_) {
      // Sessao ausente/expirada: segue no login.
    }
  }

  document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", (event) => {
      const input = event.target.previousElementSibling;
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      event.target.textContent = reveal ? "🙈" : "👁️";
    });
  });

  document.getElementById("go-register")?.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(viewRegister);
    document.getElementById("reg-error").textContent = "";
  });

  document.getElementById("go-login")?.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(viewLogin);
    document.getElementById("login-error").textContent = "";
  });

  document.getElementById("cancel-verify")?.addEventListener("click", (event) => {
    event.preventDefault();
    verificationData = null;
    switchView(viewLogin);
  });

  const remembered = localStorage.getItem(DB_REMEMBER);
  const savedSession = safeJsonParse(localStorage.getItem(DB_SESSION), null);
  if (savedSession?.sessionToken) {
    setSessionToken(savedSession.sessionToken);
  }
  if (remembered) {
    const rememberInput = document.getElementById("login-remember");
    const usernameInput = document.getElementById("login-username");
    if (rememberInput) rememberInput.checked = true;
    if (usernameInput) usernameInput.value = remembered;
  }

  void verifyCookieSessionAndRedirect();

  document.getElementById("form-login")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const userInp = document.getElementById("login-username").value.trim();
    const passInp = document.getElementById("login-password").value;
    const remember = document.getElementById("login-remember").checked;
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";

    void withLoading(async () => {
      try {
        const data = await apiJsonWithTimeout("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: userInp,
            passwordHash: hashPassword(passInp),
          }),
        });

        if (remember) {
          localStorage.setItem(DB_REMEMBER, String(data.username || userInp));
        } else {
          localStorage.removeItem(DB_REMEMBER);
        }

        localStorage.setItem(
          DB_SESSION,
          JSON.stringify({
            username: String(data.username || userInp),
            sessionToken: String(data.sessionToken || ""),
            token: Date.now(),
          })
        );
        if (data.sessionToken) {
          setSessionToken(data.sessionToken);
        } else {
          clearSessionToken();
        }
        window.location.href = toPage("menu.html");
      } catch (error) {
        errorEl.textContent = error?.message || "Falha ao fazer login.";
      }
    });
  });

  document.getElementById("form-register")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const userInp = document.getElementById("reg-username").value.trim();
    const emailInp = document.getElementById("reg-email").value.trim();
    const passInp = document.getElementById("reg-password").value;
    const tribeRadio = document.querySelector('input[name="reg-tribe"]:checked');
    const errorEl = document.getElementById("reg-error");
    errorEl.textContent = "";

    void withLoading(async () => {
      if (passInp.length < 6) {
        errorEl.textContent = "A senha deve ter no minimo 6 caracteres.";
        return;
      }
      if (!tribeRadio) {
        errorEl.textContent = "Por favor, selecione sua tribo favorita.";
        return;
      }

      try {
        const data = await apiJsonWithTimeout("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: userInp,
            email: emailInp,
            passwordHash: hashPassword(passInp),
            tribe: tribeRadio.value,
          }),
        });

        verificationData = { username: String(data.username || userInp), tribe: String(tribeRadio.value || "") };
        document.getElementById("verify-email-display").textContent = emailInp;
        document.getElementById("verify-error").textContent = "";
        document.getElementById("verify-success").textContent = "Codigo enviado para seu e-mail. Confira sua caixa de entrada.";
        document.getElementById("verify-code").value = "";
        switchView(viewVerify);
      } catch (error) {
        errorEl.textContent = error?.message || "Falha ao registrar.";
      }
    });
  });

  document.getElementById("resend-code")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!verificationData?.username) {
      return;
    }

    void withLoading(async () => {
      const verifyErr = document.getElementById("verify-error");
      const verifyOk = document.getElementById("verify-success");
      try {
        await apiJsonWithTimeout("/api/auth/resend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: verificationData.username }),
        });
        verifyErr.textContent = "";
        verifyOk.textContent = "Novo codigo enviado para seu e-mail.";
      } catch (error) {
        verifyErr.textContent = error?.message || "Nao foi possivel reenviar o codigo.";
      }
    });
  });

  document.getElementById("form-verify")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const codeInp = document.getElementById("verify-code").value.trim();
    const errorEl = document.getElementById("verify-error");
    const successEl = document.getElementById("verify-success");
    errorEl.textContent = "";
    successEl.textContent = "";

    if (!verificationData?.username) {
      errorEl.textContent = "Sessao invalida. Tente cadastrar novamente.";
      return;
    }

    void withLoading(async () => {
      try {
        const data = await apiJsonWithTimeout("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: verificationData.username,
            code: codeInp,
          }),
        });

        localStorage.setItem(
          DB_SESSION,
          JSON.stringify({
            username: String(data.username || verificationData.username),
            sessionToken: String(data.sessionToken || ""),
            token: Date.now(),
          })
        );
        if (data.sessionToken) {
          setSessionToken(data.sessionToken);
        } else {
          clearSessionToken();
        }

        try {
          await apiJsonWithTimeout("/api/profile/bootstrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: data.username,
              favoriteTribe: data.tribe || verificationData.tribe || "",
            }),
          });
        } catch (_) {
          // Bootstrap failure should not block login.
        }

        verificationData = null;
        window.location.href = toPage("menu.html");
      } catch (error) {
        errorEl.textContent = error?.message || "Falha na verificacao.";
      }
    });
  });
});
