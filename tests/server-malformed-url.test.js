const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? Number(address.port || 0) : 0;
      srv.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await wait(300);
  }
  throw new Error("timeout_waiting_server_health");
}

async function withServer(run) {
  const port = await getFreePort();
  const cwd = path.resolve(__dirname, "..");
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk || "");
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk || "");
  });
  try {
    await waitForServer(baseUrl);
    await run(baseUrl);
  } catch (error) {
    throw new Error(`${String(error?.message || error)}\n--- server output ---\n${output}`);
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      wait(3000).then(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }),
    ]);
  }
}

test("rotas com URL malformada retornam 400 sem 500", async () => {
  await withServer(async (baseUrl) => {
    const apiDeck = await fetch(`${baseUrl}/api/decks/%E0%A4%A`);
    assert.equal(apiDeck.status, 400);
    const apiDeckBody = await apiDeck.json();
    assert.match(String(apiDeckBody?.error || ""), /malformada/i);

    const apiCreature = await fetch(`${baseUrl}/api/creature-drops/location/%E0%A4%A`);
    assert.equal(apiCreature.status, 400);
    const apiCreatureBody = await apiCreature.json();
    assert.match(String(apiCreatureBody?.error || ""), /malformada/i);

    const downloads = await fetch(`${baseUrl}/downloads/%E0%A4%A`);
    assert.equal(downloads.status, 400);
    const downloadsText = await downloads.text();
    assert.match(downloadsText.toLowerCase(), /bad request/);

    const music = await fetch(`${baseUrl}/music/%E0%A4%A`);
    assert.equal(music.status, 400);
    const musicText = await music.text();
    assert.match(musicText.toLowerCase(), /bad request/);
  });
});
