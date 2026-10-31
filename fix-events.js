const fs = require("fs");
const path = require("path");

const eventsDir = path.join(__dirname, "Events");

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");

  let changed = false;

  if (content.includes('name: "ready"')) {
    content = content.replaceAll('name: "ready"', 'name: "clientReady"');
    changed = true;
  }

  if (content.includes("name: 'ready'")) {
    content = content.replaceAll("name: 'ready'", "name: 'clientReady'");
    changed = true;
  }

  if (content.includes('bot.on("ready"')) {
    content = content.replaceAll('bot.on("ready"', 'bot.on("clientReady"');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`[FIXED] ${filePath}`);
  }
}

function scanDir(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      scanDir(fullPath);
    } else if (file.endsWith(".js")) {
      fixFile(fullPath);
    }
  }
}

console.log("🔧 Scan des events en cours...");
scanDir(eventsDir);
console.log("✅ Terminé !");