import { initMatrixEffect } from "./matrix.js";
import { clearSessionToken, getRuntimeConfig, getSessionToken, setSessionToken, toPage } from "./runtime-config.js";

const DB_SESSION = "chaotic_session";
const DB_REMEMBER = "chaotic_remember";
const DB_VERIFY_SESSION = "chaotic_verify_session";

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
  const runtimeConfig = getRuntimeConfig();
  const turnstileSiteKey = String(runtimeConfig?.turnstileSiteKey || "").trim();
  const viewLogin = document.getElementById("view-login");
  const viewRegister = document.getElementById("view-register");
  const viewVerify = document.getElementById("view-verify");
  const overlay = document.getElementById("loading-overlay");
  const turnstileWidgetContainer = document.getElementById("turnstile-widget");
  const turnstileStatus = document.getElementById("turnstile-status");

  let verificationData = null; // { username, tribe, email, createdAt }
  let turnstileToken = "";
  let turnstileWidgetId = null;
  let turnstileRendered = false;

  const switchView = (viewToShow) => {
    [viewLogin, viewRegister, viewVerify].forEach((view) => {
      view.classList.remove("active");
    });
    viewToShow.classList.add("active");
  };

  const persistVerificationSession = () => {
    if (!verificationData?.username) {
      localStorage.removeItem(DB_VERIFY_SESSION);
      return;
    }
    localStorage.setItem(DB_VERIFY_SESSION, JSON.stringify({
      username: String(verificationData.username || ""),
      tribe: String(verificationData.tribe || ""),
      email: String(verificationData.email || ""),
      createdAt: Number(verificationData.createdAt || Date.now()),
    }));
  };

  const clearVerificationSession = () => {
    localStorage.removeItem(DB_VERIFY_SESSION);
  };

  const renderVerifyContext = () => {
    if (document.getElementById("verify-email-display")) {
      document.getElementById("verify-email-display").textContent = String(verificationData?.email || "");
    }
  };

  const setTurnstileStatus = (message = "", isError = false) => {
    if (!turnstileStatus) {
      return;
    }
    turnstileStatus.textContent = String(message || "");
    turnstileStatus.classList.toggle("error", Boolean(isError));
  };

  const resetTurnstileIfPossible = () => {
    turnstileToken = "";
    if (window.turnstile && turnstileWidgetId !== null) {
      try {
        window.turnstile.reset(turnstileWidgetId);
      } catch (_) {
        // ignore reset failure
      }
    }
  };

  function mountTurnstileWidget() {
    if (!turnstileWidgetContainer || !turnstileSiteKey || turnstileRendered || !window.turnstile) {
      return;
    }
    try {
      turnstileWidgetId = window.turnstile.render(turnstileWidgetContainer, {
        sitekey: turnstileSiteKey,
        theme: "dark",
        callback(token) {
          turnstileToken = String(token || "").trim();
          setTurnstileStatus("Verificacao anti-bot concluida.");
        },
        "expired-callback"() {
          turnstileToken = "";
          setTurnstileStatus("Verificacao anti-bot expirou. Valide novamente.", true);
        },
        "error-callback"() {
          turnstileToken = "";
          setTurnstileStatus("Falha ao carregar captcha. Recarregue a pagina.", true);
        },
      });
      turnstileRendered = true;
      setTurnstileStatus("Complete a verificacao anti-bot para cadastrar.");
    } catch (_) {
      setTurnstileStatus("Falha ao iniciar captcha. Recarregue a pagina.", true);
    }
  }

  function setupTurnstile() {
    if (!turnstileWidgetContainer || !turnstileStatus) {
      return;
    }
    if (!turnstileSiteKey) {
      setTurnstileStatus("Captcha nao configurado no frontend. Defina turnstileSiteKey em public/config.js.", true);
      return;
    }
    if (window.turnstile) {
      mountTurnstileWidget();
      return;
    }
    const existingScript = document.querySelector('script[data-chaotic-turnstile="1"]');
    if (existingScript) {
      return;
    }
    const scriptEl = document.createElement("script");
    scriptEl.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    scriptEl.async = true;
    scriptEl.defer = true;
    scriptEl.dataset.chaoticTurnstile = "1";
    scriptEl.onload = () => mountTurnstileWidget();
    scriptEl.onerror = () => setTurnstileStatus("Falha ao carregar captcha. Verifique bloqueadores de script.", true);
    document.head.appendChild(scriptEl);
    setTurnstileStatus("Carregando verificacao anti-bot...");
  }

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
    setupTurnstile();
  });

  document.getElementById("go-login")?.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(viewLogin);
    document.getElementById("login-error").textContent = "";
  });

  document.getElementById("cancel-verify")?.addEventListener("click", (event) => {
    event.preventDefault();
    verificationData = null;
    clearVerificationSession();
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

  const restoreVerifySession = safeJsonParse(localStorage.getItem(DB_VERIFY_SESSION), null);
  if (restoreVerifySession?.username) {
    const ageMs = Date.now() - Math.max(0, Number(restoreVerifySession.createdAt || 0));
    if (ageMs <= (30 * 60 * 1000)) {
      verificationData = {
        username: String(restoreVerifySession.username || "").trim(),
        tribe: String(restoreVerifySession.tribe || "").trim(),
        email: String(restoreVerifySession.email || "").trim(),
        createdAt: Number(restoreVerifySession.createdAt || Date.now()),
      };
      if (verificationData.username) {
        renderVerifyContext();
        const successEl = document.getElementById("verify-success");
        const errorEl = document.getElementById("verify-error");
        if (successEl) {
          successEl.textContent = "Continue a verificacao da conta com o codigo recebido por e-mail.";
        }
        if (errorEl) {
          errorEl.textContent = "";
        }
        switchView(viewVerify);
      } else {
        clearVerificationSession();
      }
    } else {
      clearVerificationSession();
    }
  }

  void verifyCookieSessionAndRedirect();
  setupTurnstile();

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
      if (!turnstileSiteKey) {
        errorEl.textContent = "Captcha anti-bot nao configurado. Fale com o administrador.";
        return;
      }
      if (!turnstileToken) {
        errorEl.textContent = "Complete a verificacao anti-bot para continuar.";
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
            turnstileToken,
          }),
        });

        verificationData = {
          username: String(data.username || userInp),
          tribe: String(tribeRadio.value || ""),
          email: String(data.email || emailInp || ""),
          createdAt: Date.now(),
        };
        persistVerificationSession();
        renderVerifyContext();
        document.getElementById("verify-error").textContent = "";
        document.getElementById("verify-success").textContent = data?.pendingResumed
          ? "Conta pendente retomada. Enviamos um novo codigo para seu e-mail."
          : "Codigo enviado para seu e-mail. Confira sua caixa de entrada.";
        document.getElementById("verify-code").value = "";
        switchView(viewVerify);
        resetTurnstileIfPossible();
      } catch (error) {
        errorEl.textContent = error?.message || "Falha ao registrar.";
        resetTurnstileIfPossible();
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
        clearVerificationSession();
        window.location.href = toPage("menu.html");
      } catch (error) {
        errorEl.textContent = error?.message || "Falha na verificacao.";
      }
    });
  });
});
