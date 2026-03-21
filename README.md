# 🤖 AlphaBot Auto-Enter Discord Bot

Automatically enters Alphabot raffles for your users — directly from Discord with a button-based control panel.

---

## ✨ Features

| Button | What it does |
|---|---|
| 📝 Submit API Key | User pastes their Alphabot API key (validated instantly) |
| 🟢 Start | Begins auto-entering raffles |
| 🔴 Stop | Stops the bot for that user |
| 🌐 All Raffles | Enters every open raffle on Alphabot |
| 👥 My Communities | Only enters raffles from communities the user is in |
| 📌 Custom Teams | Filter to specific team IDs |
| 🪪 Input Team IDs | Paste team IDs or a URL with `alphas=` params |
| 📊 Stats | Shows total entered, won, win rate, recent entries |
| ⏱ Delay | Set seconds between entries (anti-rate-limit) |
| 🗑️ Remove My Data | Wipes their API key and all stored data |

---

## 🚀 Setup (Local)

### 1. Clone & install
```bash
git clone <your-repo>
cd alphabot-discord-bot
npm install
```

### 2. Create a Discord Bot
1. Go to https://discord.com/developers/applications
2. Click **New Application**
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token** click **Reset Token** and copy it
5. Enable **Server Members Intent** and **Message Content Intent**
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Messages/View Channels`, `Embed Links`, `Use Slash Commands`
7. Copy the generated URL and invite the bot to your server

### 3. Configure environment
```bash
cp .env.example .env
```
Fill in:
```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id   # Found in General Information tab
GUILD_ID=your_server_id         # Right-click server → Copy Server ID (enable Dev Mode first)
```

### 4. Run the bot
```bash
npm start
```

### 5. Spawn the control panel
In any Discord channel, type:
```
/panel
```

---

## ☁️ Hosting on Railway (Recommended — Free)

Railway gives you a free persistent server — perfect for a Discord bot.

### Steps:
1. Go to https://railway.app and sign up with GitHub
2. Click **New Project → Deploy from GitHub Repo**
3. Connect your GitHub and select this repo
4. Go to **Variables** and add all your `.env` values
5. Railway auto-detects Node.js and runs `npm start`
6. Your bot will be live 24/7 🎉

> 💡 Railway's free tier gives $5/month credit — more than enough for a Discord bot.

---

## 🗂️ Project Structure

```
src/
  index.js                  # Bot entry point, slash commands
  handlers/
    interactionHandler.js   # All button clicks & modal submissions
  services/
    database.js             # SQLite — user data, entries, stats
    alphabot.js             # Alphabot API calls
    autoEnter.js            # Core entry loop (runs every 2 min)
  utils/
    panelBuilder.js         # Builds the Discord embed + buttons
data/
  users.db                  # Auto-created SQLite database
```

---

## 🔐 Security Notes

- API keys are stored locally in SQLite (encrypted at-rest on Railway)
- Each user's data is isolated by Discord ID
- Users can wipe all their data at any time with **🗑️ Remove My Data**
- Never share your `.env` or `users.db` file

---

## 📡 How It Works

1. User runs `/panel` → control panel appears
2. User submits their Alphabot API key (validated against the API)
3. User clicks **Start**
4. Every 2 minutes, the bot:
   - Fetches open raffles (based on their selected mode)
   - Skips any already-entered raffles
   - Enters new ones with a configurable delay
   - Logs entries to the database
5. User receives a DM summary after each pass with new entries
