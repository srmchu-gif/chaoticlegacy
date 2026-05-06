export function initMatrixEffect(containerId = "matrix-bg") {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("canvas");
    container.id = containerId;
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.zIndex = "-2"; // Behind everything, but above pure background
    container.style.opacity = "0.3"; // Subtle effect
    document.body.prepend(container);
  }

  const canvas = container;
  const ctx = canvas.getContext("2d");

  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*";
  const fontSize = 16;
  let columns = Math.floor(width / fontSize);
  let drops = [];

  for (let x = 0; x < columns; x++) {
    drops[x] = Math.random() * height; // Start at random Y offsets
  }

  window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    columns = Math.floor(width / fontSize);
    drops = [];
    for (let x = 0; x < columns; x++) {
      drops[x] = Math.random() * height;
    }
  });

  function draw() {
    ctx.fillStyle = "rgba(7, 9, 15, 0.1)"; // Fade effect
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#00d2ff"; // Chaotic Blue
    ctx.font = fontSize + "px 'Orbitron', monospace";

    for (let i = 0; i < drops.length; i++) {
      const text = characters.charAt(Math.floor(Math.random() * characters.length));
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  const interval = setInterval(draw, 50);
  return () => clearInterval(interval);
}

export function explodeIntoCode(x, y, width, height, containerNode) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = x + 'px';
  canvas.style.top = y + 'px';
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '100';
  
  // Set actual canvas size
  canvas.width = width;
  canvas.height = height;
  containerNode.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const particles = [];
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: width / 2,
      y: height / 2,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      char: characters.charAt(Math.floor(Math.random() * characters.length)),
      life: 1.0,
      size: Math.random() * 15 + 10
    });
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.006;
      
      if (Math.random() > 0.9) {
        p.char = characters.charAt(Math.floor(Math.random() * characters.length));
      }

      ctx.fillStyle = `rgba(0, 210, 255, ${p.life})`;
      ctx.font = p.size + "px 'Orbitron', monospace";
      ctx.fillText(p.char, p.x, p.y);
    }

    if (alive) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(animate);
}
