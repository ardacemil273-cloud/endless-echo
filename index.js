// ECHO — Discord Server Intelligence Bot
// Tek dosya: index.js
// Topluluk, AFK, SQLite hafıza, analiz, DNA, timeline, anomaly, lore, world,
// achievement, catch-up, ticket, başvuru, öneri, doğrulama ve etkinlik sistemi.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

// ============================================================
// CONFIG
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "echo.sqlite");
const VERSION = "1.0.0";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID zorunludur.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ============================================================
// DATABASE
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL DEFAULT 0,
  night_messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS afk (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  old_nickname TEXT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS afk_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hourly_activity (
  guild_id TEXT NOT NULL,
  hour INTEGER NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, hour)
);
CREATE TABLE IF NOT EXISTS channel_activity (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, channel_id)
);
CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  baseline INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  clue TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lore (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  fictional INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  secret INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_achievements (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  achievement_key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, achievement_key)
);
CREATE TABLE IF NOT EXISTS world_state (
  guild_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  event_time TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS member_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);
`);

const seedAchievements = [
  ["first_message", "İlk Mesaj", "Sunucudaki ilk mesajını gönder.", 0],
  ["messages_100", "100 Mesaj", "100 mesaj gönder.", 0],
  ["messages_1000", "1000 Mesaj", "1000 mesaj gönder.", 0],
  ["first_voice", "İlk Ses Kanalı", "İlk kez ses kanalına katıl.", 0],
  ["night_owl", "Gece Kuşu", "Gece saatlerinde aktif ol.", 0],
  ["anomaly_survivor", "Anomali Tanığı", "Bir anomali tespit edildiğinde sunucuda bulun.", 1],
  ["secret_finder", "Gizli Tanık", "Gizli bir olayı keşfet.", 1],
];
const insertAchievement = db.prepare("INSERT OR IGNORE INTO achievements (key,title,description,secret) VALUES (?,?,?,?)");
for (const achievement of seedAchievements) insertAchievement.run(...achievement);

// ============================================================
// HELPERS
// ============================================================
const now = () => Math.floor(Date.now() / 1000);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pct = (value) => `${clamp(Math.round(value), 0, 100)}%`;
const fmtDuration = (seconds) => {
  seconds = Math.max(0, Math.floor(seconds));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} gün ${h} saat`;
  if (h) return `${h} saat ${m} dakika`;
  return `${m} dakika`;
};
const safeName = (name) => String(name || "Üye").replace(/\n/g, " ").slice(0, 80);
const embed = (title, description, color = "5865F2") =>
  new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp().setFooter({ text: `ECHO v${VERSION}` });
const errorEmbed = (text) => embed("❌ İşlem gerçekleştirilemedi", text, "ED4245");
const okEmbed = (title, text) => embed(`✅ ${title}`, text, "57F287");

function upsertUser(guildId, user) {
  const timestamp = now();
  db.prepare(`INSERT INTO users (guild_id,user_id,username,first_seen,last_seen,last_message_at)
    VALUES (?,?,?,?,?,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET username=excluded.username,last_seen=excluded.last_seen`)
    .run(guildId, user.id, safeName(user.username || user.displayName), timestamp, timestamp);
}

function addTimeline(guildId, type, title, description) {
  db.prepare("INSERT INTO timeline (guild_id,type,title,description,created_at) VALUES (?,?,?,?,?)")
    .run(guildId, type, title, description, now());
}

function getSetting(guildId, key, fallback = null) {
  return db.prepare("SELECT value FROM settings WHERE guild_id=? AND key=?").get(guildId, key)?.value || fallback;
}
function setSetting(guildId, key, value) {
  db.prepare("INSERT INTO settings(guild_id,key,value) VALUES(?,?,?) ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value")
    .run(guildId, key, String(value));
}
function getChannel(guild, key, names = []) {
  const configured = getSetting(guild.id, key);
  if (configured) return guild.channels.cache.get(configured);
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && names.includes(c.name));
}
function isStaff(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}
function memberHas(member, permission) {
  return member?.permissions?.has(permission);
}
function mentionUser(guild, id) {
  return guild.members.cache.get(id)?.user?.username || `<@${id}>`;
}
function randomItem(array) { return array[Math.floor(Math.random() * array.length)]; }

async function replyError(interaction, text) {
  const payload = { embeds: [errorEmbed(text)], ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function sendLog(guild, title, description, color = "5865F2") {
  const channel = getChannel(guild, "log_channel_id", ["log", "bot-log", "mod-log"]);
  if (channel) await channel.send({ embeds: [embed(title, description, color)] }).catch(() => {});
}

function getWorld(guildId) {
  let world = db.prepare("SELECT * FROM world_state WHERE guild_id=?").get(guildId);
  if (!world) {
    db.prepare("INSERT INTO world_state(guild_id,level,xp,updated_at) VALUES(?,?,?,?)").run(guildId, 1, 0, now());
    world = db.prepare("SELECT * FROM world_state WHERE guild_id=?").get(guildId);
  }
  return world;
}
function worldName(level) {
  return ["Köy", "Kasaba", "Şehir", "Metropol", "Dijital Dünya", "UNKNOWN"][clamp(level - 1, 0, 5)];
}
function addWorldXp(guildId, amount) {
  const world = getWorld(guildId);
  const xp = world.xp + amount;
  const level = clamp(1 + Math.floor(xp / 500), 1, 6);
  db.prepare("UPDATE world_state SET xp=?,level=?,updated_at=? WHERE guild_id=?").run(xp, level, now(), guildId);
  if (level > world.level) {
    addTimeline(guildId, "world", "Dünya gelişti", `Sunucunun dünyası **${worldName(level)}** seviyesine ulaştı.`);
    return { level, changed: true };
  }
  return { level, changed: false };
}

function unlockAchievement(guildId, userId, key) {
  const achievement = db.prepare("SELECT * FROM achievements WHERE key=?").get(key);
  if (!achievement) return false;
  const result = db.prepare("INSERT OR IGNORE INTO user_achievements(guild_id,user_id,achievement_key,unlocked_at) VALUES(?,?,?,?)")
    .run(guildId, userId, key, now());
  if (result.changes) {
    addTimeline(guildId, "achievement", "Başarım açıldı", `${mentionUser(client.guilds.cache.get(guildId), userId)} **${achievement.title}** başarımını açtı.`);
    return true;
  }
  return false;
}

function messageCount(guildId, since = 0) {
  if (!since) return db.prepare("SELECT COALESCE(SUM(message_count),0) AS count FROM users WHERE guild_id=?").get(guildId).count;
  return db.prepare("SELECT COALESCE(SUM(message_count),0) AS count FROM users WHERE guild_id=? AND last_message_at>=?").get(guildId, since).count;
}

function buildCommands() {
  return [
    new SlashCommandBuilder().setName("e").setDescription("ECHO sunucu zekâ sistemi")
      .addSubcommand((s) => s.setName("afk").setDescription("AFK modunu aç/kapat").addStringOption((o) => o.setName("sebep").setDescription("AFK sebebi")))
      .addSubcommand((s) => s.setName("afk-gecmis").setDescription("AFK geçmişini göster"))
      .addSubcommand((s) => s.setName("profil").setDescription("Aktivite profilini göster").addUserOption((o) => o.setName("kullanici").setDescription("Profiline bakılacak kişi")))
      .addSubcommand((s) => s.setName("dna").setDescription("Kullanıcı DNA analizini göster").addUserOption((o) => o.setName("kullanici").setDescription("Analiz edilecek kişi")))
      .addSubcommand((s) => s.setName("sunucu").setDescription("Server DNA bilgisini göster"))
      .addSubcommand((s) => s.setName("analiz").setDescription("Sunucu aktivite analizini göster"))
      .addSubcommand((s) => s.setName("gecmis").setDescription("Sunucu timeline geçmişini göster"))
      .addSubcommand((s) => s.setName("neleroldu").setDescription("Sen yokken sunucuda neler olduğunu göster"))
      .addSubcommand((s) => s.setName("anomaliler").setDescription("Son anomalileri göster"))
      .addSubcommand((s) => s.setName("gizli").setDescription("Gizli olayları ve ipuçlarını göster"))
      .addSubcommand((s) => s.setName("olay").setDescription("Manuel dünya olayı başlat").addStringOption((o) => o.setName("baslik").setDescription("Olay başlığı").setRequired(true)).addStringOption((o) => o.setName("aciklama").setDescription("Olay açıklaması").setRequired(true)))
      .addSubcommand((s) => s.setName("lore").setDescription("Sunucu hikâyesini göster"))
      .addSubcommand((s) => s.setName("basarimlar").setDescription("Başarımlarını göster").addUserOption((o) => o.setName("kullanici").setDescription("Başarımlarına bakılacak kişi")))
      .addSubcommand((s) => s.setName("dunya").setDescription("Sunucunun gelişen dünyasını göster"))
      .addSubcommand((s) => s.setName("tahmin").setDescription("Eğlenceli aktivite tahmini göster"))
      .addSubcommand((s) => s.setName("archive").setDescription("ECHO arşiv özetini göster"))
      .addSubcommand((s) => s.setName("istatistik").setDescription("Kısa sunucu istatistiklerini göster"))
      .addSubcommand((s) => s.setName("ticket-panel").setDescription("Ticket paneli gönder"))
      .addSubcommand((s) => s.setName("basvuru-panel").setDescription("Yetkili başvuru paneli gönder"))
      .addSubcommand((s) => s.setName("oneri-panel").setDescription("Öneri paneli gönder"))
      .addSubcommand((s) => s.setName("dogrulama-panel").setDescription("Doğrulama paneli gönder"))
      .addSubcommand((s) => s.setName("rol-panel").setDescription("Self-role paneli gönder"))
      .addSubcommand((s) => s.setName("etkinlik").setDescription("Etkinlik duyurusu oluştur").addStringOption((o) => o.setName("baslik").setDescription("Başlık").setRequired(true)).addStringOption((o) => o.setName("tarih").setDescription("Tarih").setRequired(true)).addStringOption((o) => o.setName("aciklama").setDescription("Açıklama").setRequired(true)))
      .toJSON(),
  ];
}

// ============================================================
// AFK SYSTEM
// ============================================================
async function moveToAfkChannel(member) {
  if (!member.voice?.channelId) return;
  let channel = member.guild.channels.cache.find(
    (item) => item.type === ChannelType.GuildVoice && item.name.toLowerCase() === "afk"
  );
  if (!channel) {
    channel = await member.guild.channels.create({
      name: "AFK",
      type: ChannelType.GuildVoice,
      reason: "ECHO AFK sistemi",
    }).catch(() => null);
  }
  if (channel) await member.voice.setChannel(channel, "ECHO AFK sistemi").catch(() => {});
}

async function enableAfk(interaction, reason) {
  const existing = db.prepare("SELECT * FROM afk WHERE guild_id=? AND user_id=?").get(interaction.guildId, interaction.user.id);
  if (existing) return interaction.reply({ embeds: [errorEmbed("Zaten AFK durumundasın.")], ephemeral: true });
  const member = interaction.member;
  const oldNickname = member.nickname || "";
  const nickname = `[AFK] ${member.displayName}`.slice(0, 32);
  const finalReason = reason || "Sebep belirtilmedi.";
  db.prepare("INSERT INTO afk(guild_id,user_id,reason,started_at,old_nickname) VALUES(?,?,?,?,?)")
    .run(interaction.guildId, interaction.user.id, finalReason, now(), oldNickname);
  await member.setNickname(nickname).catch(() => {});
  await moveToAfkChannel(member);
  addTimeline(interaction.guildId, "afk", "AFK modu", `${interaction.user} AFK oldu.`);
  return interaction.reply({ embeds: [okEmbed("AFK aktif", `Artık AFK'sın.\n**Sebep:** ${finalReason}`)] });
}

async function disableAfk(member, channel) {
  const record = db.prepare("SELECT * FROM afk WHERE guild_id=? AND user_id=?").get(member.guild.id, member.id);
  if (!record) return false;
  const ended = now();
  const duration = ended - record.started_at;
  db.prepare("INSERT INTO afk_history(guild_id,user_id,reason,started_at,ended_at,duration_seconds) VALUES(?,?,?,?,?,?)")
    .run(member.guild.id, member.id, record.reason, record.started_at, ended, duration);
  db.prepare("DELETE FROM afk WHERE guild_id=? AND user_id=?").run(member.guild.id, member.id);
  await member.setNickname(record.old_nickname || null).catch(() => {});
  if (channel) await channel.send({ embeds: [embed("👋 Tekrar hoş geldin", `${member} AFK'dan döndü.\n**Süre:** ${fmtDuration(duration)}\n**Sebep:** ${record.reason}`, "57F287")] }).catch(() => {});
  return true;
}

// ============================================================
// USER DNA / SERVER DNA / ANALYTICS
// ============================================================
function userStats(guildId, userId) {
  return db.prepare("SELECT * FROM users WHERE guild_id=? AND user_id=?").get(guildId, userId) || { message_count: 0, voice_seconds: 0, night_messages: 0, last_seen: now() };
}
function userDna(guildId, userId) {
  const stats = userStats(guildId, userId);
  const social = clamp(35 + stats.message_count / 8, 0, 99);
  const voice = clamp(stats.voice_seconds / 60 / 10, 0, 99);
  const night = stats.message_count ? clamp((stats.night_messages / stats.message_count) * 220, 0, 99) : 0;
  const activity = clamp(20 + Math.log10(stats.message_count + 1) * 20 + voice / 5, 0, 99);
  const type = night > 65 ? "GECECİ SOSYAL" : social > 70 ? "AKTİF TOPLULUKÇU" : voice > 60 ? "SES OYUNCUSU" : "SESSİZ GÖZLEMCİ";
  return { social, voice, night, activity, type };
}
function serverDna(guildId) {
  const total = messageCount(guildId);
  const users = db.prepare("SELECT COUNT(*) AS count FROM users WHERE guild_id=? AND message_count>0").get(guildId).count;
  const night = db.prepare("SELECT COALESCE(SUM(night_messages),0) AS count FROM users WHERE guild_id=?").get(guildId).count;
  const active = clamp(25 + Math.log10(total + 1) * 18 + users, 0, 99);
  const tags = [];
  if (active > 55) tags.push("Sosyal");
  if (night > total * 0.25) tags.push("Gececi");
  if (total > 500) tags.push("Kaotik");
  if (!tags.length) tags.push("Sakin");
  return { total, users, night, active, tags, type: tags.includes("Gececi") ? "GECECİ KAOS" : tags.join(" ").toUpperCase() };
}

// ============================================================
// SECRET / LORE / ACHIEVEMENT / WORLD ENGINES
// ============================================================
function ensureLore(guildId) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM lore WHERE guild_id=?").get(guildId).count;
  if (!count) {
    db.prepare("INSERT INTO lore(guild_id,chapter,title,body,fictional,created_at) VALUES(?,?,?,?,?,?)")
      .run(guildId, 1, "The Beginning", "ECHO sunucunun ilk izlerini kaydetti.", 1, now());
  }
}
function createSecret(guildId) {
  const exists = db.prepare("SELECT COUNT(*) AS count FROM secrets WHERE guild_id=? AND discovered=0").get(guildId).count;
  if (exists || Math.random() > 0.12) return;
  const secrets = [
    ["03:17", "Gece yarısından sonra #sohbet kanalına dikkat et."],
    ["Bilinmeyen İmza", "Bir kullanıcı bugün normalden farklı davrandı."],
    ["Kayıp Mesaj", "ECHO eski bir mesajın yankısını buldu."],
  ];
  const [title, clue] = randomItem(secrets);
  db.prepare("INSERT INTO secrets(guild_id,title,clue,created_at) VALUES(?,?,?,?)").run(guildId, title, clue, now());
  addTimeline(guildId, "secret", "Gizli olay oluştu", "ECHO yeni bir ipucu kaydetti.");
}
function checkAchievements(guildId, userId) {
  const stats = userStats(guildId, userId);
  const unlocked = [];
  if (stats.message_count >= 1 && unlockAchievement(guildId, userId, "first_message")) unlocked.push("İlk Mesaj");
  if (stats.message_count >= 100 && unlockAchievement(guildId, userId, "messages_100")) unlocked.push("100 Mesaj");
  if (stats.message_count >= 1000 && unlockAchievement(guildId, userId, "messages_1000")) unlocked.push("1000 Mesaj");
  if (stats.night_messages >= 10 && unlockAchievement(guildId, userId, "night_owl")) unlocked.push("Gece Kuşu");
  return unlocked;
}
function runAnomaly(guild) {
  const since = now() - 300;
  const recent = db.prepare("SELECT COUNT(*) AS count FROM users WHERE guild_id=? AND last_message_at>=?").get(guild.id, since).count;
  const baseline = Math.max(5, Math.round(messageCount(guild.id) / Math.max(1, Math.floor((now() - (getWorld(guild.id).updated_at || now())) / 300))));
  if (recent < 20 || recent < baseline * 3) return null;
  const description = `Son 5 dakikada **${recent}** aktivite tespit edildi. Normal seviye yaklaşık **${baseline}**. Aktivite **%${Math.round((recent / baseline - 1) * 100)}** arttı.`;
  db.prepare("INSERT INTO anomalies(guild_id,message_count,baseline,description,created_at) VALUES(?,?,?,?,?)").run(guild.id, recent, baseline, description, now());
  addTimeline(guild.id, "anomaly", "Anomali tespit edildi", description);
  return description;
}

// ============================================================
// COMMAND HANDLERS
// ============================================================
async function handleCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const user = interaction.user;
  upsertUser(guild.id, user);

  if (["ticket-panel", "basvuru-panel", "oneri-panel", "dogrulama-panel", "rol-panel", "etkinlik", "olay"].includes(sub) && !isStaff(interaction)) {
    return replyError(interaction, "Bu komut için `Sunucuyu Yönet` yetkisi gerekiyor.");
  }

  if (sub === "afk") return enableAfk(interaction, interaction.options.getString("sebep"));
  if (sub === "afk-gecmis") {
    const rows = db.prepare("SELECT * FROM afk_history WHERE guild_id=? AND user_id=? ORDER BY ended_at DESC LIMIT 5").all(guild.id, user.id);
    const total = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(duration_seconds),0) AS seconds FROM afk_history WHERE guild_id=? AND user_id=?").get(guild.id, user.id);
    const history = rows.map((r) => `• ${new Date(r.ended_at * 1000).toLocaleDateString("tr-TR")} — ${fmtDuration(r.duration_seconds)} — ${r.reason}`).join("\n") || "Henüz AFK geçmişi yok.";
    return interaction.reply({ embeds: [embed("💤 AFK Geçmişi", `Toplam AFK: **${total.count}**\nToplam süre: **${fmtDuration(total.seconds)}**\n\n${history}`)] });
  }
  if (sub === "profil" || sub === "dna") {
    const target = interaction.options.getUser("kullanici") || user;
    const stats = userStats(guild.id, target.id);
    const dna = userDna(guild.id, target.id);
    return interaction.reply({ embeds: [embed(`🧬 ${safeName(target.username)} DNA`, `**Sosyal:** ${pct(dna.social)}\n**Ses aktivitesi:** ${pct(dna.voice)}\n**Gece aktivitesi:** ${pct(dna.night)}\n**Genel aktivite:** ${pct(dna.activity)}\n\n**Profil tipi:** ${dna.type}\n\nMesaj: **${stats.message_count}**\nSes süresi: **${fmtDuration(stats.voice_seconds)}**\n\n_Bu eğlenceli istatistiksel profildir; psikolojik teşhis değildir._`)] });
  }
  if (sub === "sunucu") {
    const dna = serverDna(guild.id);
    return interaction.reply({ embeds: [embed("🌎 SERVER DNA", `**Karakter:** ${dna.tags.join(" • ")}\n**Aktivite:** ${pct(dna.active)}\n**Sunucu tipi:** ${dna.type}\n**Takip edilen kullanıcı:** ${dna.users}\n**Toplam mesaj:** ${dna.total}`)] });
  }
  if (sub === "analiz" || sub === "istatistik") {
    const dna = serverDna(guild.id);
    const topChannels = db.prepare("SELECT channel_name,messages FROM channel_activity WHERE guild_id=? ORDER BY messages DESC LIMIT 5").all(guild.id);
    const topUsers = db.prepare("SELECT username,message_count FROM users WHERE guild_id=? ORDER BY message_count DESC LIMIT 5").all(guild.id);
    const channelLines = topChannels.map((x) => `• #${x.channel_name}: ${x.messages}`).join("\n") || "Henüz veri yok.";
    const userLines = topUsers.map((x) => `• ${x.username}: ${x.message_count}`).join("\n") || "Henüz veri yok.";
    return interaction.reply({ embeds: [embed("📊 ECHO ANALYTICS", `**Toplam mesaj:** ${dna.total}\n**Aktif kullanıcı:** ${dna.users}\n**Gece mesajları:** ${dna.night}\n**Sunucu aktivitesi:** ${pct(dna.active)}\n\n**Aktif kanallar:**\n${channelLines}\n\n**Aktif üyeler:**\n${userLines}`)] });
  }
  if (sub === "gecmis") {
    const rows = db.prepare("SELECT * FROM timeline WHERE guild_id=? ORDER BY created_at DESC LIMIT 10").all(guild.id);
    return interaction.reply({ embeds: [embed("📜 SERVER TIMELINE", rows.map((r) => `**${new Date(r.created_at * 1000).toLocaleString("tr-TR")}** — ${r.title}\n${r.description}`).join("\n\n") || "Timeline henüz oluşmadı.")] });
  }
  if (sub === "neleroldu") {
    const since = userStats(guild.id, user.id).last_seen || now();
    const joined = db.prepare("SELECT COUNT(*) AS count FROM member_changes WHERE guild_id=? AND type='join' AND created_at>=?").get(guild.id, since).count;
    const left = db.prepare("SELECT COUNT(*) AS count FROM member_changes WHERE guild_id=? AND type='leave' AND created_at>=?").get(guild.id, since).count;
    const msgs = db.prepare("SELECT COALESCE(SUM(message_count),0) AS count FROM users WHERE guild_id=? AND last_message_at>=?").get(guild.id, since).count;
    const events = db.prepare("SELECT title,description FROM timeline WHERE guild_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 3").all(guild.id, since);
    db.prepare("UPDATE users SET last_seen=? WHERE guild_id=? AND user_id=?").run(now(), guild.id, user.id);
    const eventLines = events.map((e) => `• ${e.title}: ${e.description}`).join("\n") || "Kayda değer yeni olay yok.";
    return interaction.reply({ embeds: [embed("📬 SEN YOKKEN...", `**${joined}** kişi katıldı.\n**${left}** kişi ayrıldı.\n**${msgs}** mesaj gönderildi.\n\n**Önemli olaylar:**\n${eventLines}`)] });
  }
  if (sub === "anomaliler") {
    const rows = db.prepare("SELECT * FROM anomalies WHERE guild_id=? ORDER BY created_at DESC LIMIT 5").all(guild.id);
    return interaction.reply({ embeds: [embed("⚠️ ANOMALILER", rows.map((r) => `**${new Date(r.created_at * 1000).toLocaleString("tr-TR")}**\n${r.description}`).join("\n\n") || "Henüz anomali tespit edilmedi.")] });
  }
  if (sub === "gizli") {
    const rows = db.prepare("SELECT * FROM secrets WHERE guild_id=? ORDER BY created_at DESC LIMIT 5").all(guild.id);
    if (!rows.length) return interaction.reply({ embeds: [embed("👁️ GİZLİ", "ECHO henüz bir ipucu bulamadı. Aktivite arttıkça yeni sırlar ortaya çıkabilir.")] });
    return interaction.reply({ embeds: [embed("👁️ ECHO GİZLİ ARŞİVİ", rows.map((r) => `**${r.title}**\n${r.clue}${r.discovered ? "\n✅ Keşfedildi" : "\n🔒 Henüz keşfedilmedi"}`).join("\n\n"))] });
  }
  if (sub === "olay") {
    const title = interaction.options.getString("baslik", true);
    const description = interaction.options.getString("aciklama", true);
    addTimeline(guild.id, "event", title, description);
    addWorldXp(guild.id, 50);
    return interaction.reply({ embeds: [okEmbed("Dünya olayı kaydedildi", `**${title}**\n${description}`)] });
  }
  if (sub === "lore") {
    ensureLore(guild.id);
    const rows = db.prepare("SELECT * FROM lore WHERE guild_id=? ORDER BY chapter").all(guild.id);
    return interaction.reply({ embeds: [embed("📖 SERVER LORE", rows.map((r) => `**Chapter ${r.chapter}: ${r.title}**\n${r.body}`).join("\n\n"))] });
  }
  if (sub === "basarimlar") {
    const target = interaction.options.getUser("kullanici") || user;
    const all = db.prepare("SELECT * FROM achievements ORDER BY secret,key").all();
    const owned = new Set(db.prepare("SELECT achievement_key FROM user_achievements WHERE guild_id=? AND user_id=?").all(guild.id, target.id).map((x) => x.achievement_key));
    const text = all.map((a) => owned.has(a.key) ? `🏆 **${a.title}** — ${a.description}` : a.secret ? "🔒 ???" : `▫️ ${a.title} — ${a.description}`).join("\n");
    return interaction.reply({ embeds: [embed(`🏆 ${safeName(target.username)} Başarımları`, text)] });
  }
  if (sub === "dunya") {
    const world = getWorld(guild.id);
    return interaction.reply({ embeds: [embed("🌍 ECHO DÜNYASI", `**Seviye:** ${world.level}/6\n**Aşama:** ${worldName(world.level)}\n**Dünya XP:** ${world.xp}\n\nSunucu; mesaj, aktivite, etkinlik, başarımlar ve gizli olaylarla gelişir.`)] });
  }
  if (sub === "tahmin") {
    const dna = serverDna(guild.id);
    return interaction.reply({ embeds: [embed("🔮 SERVER FORECAST", `Yarın için eğlenceli tahmin:\n\n**Aktivite:** ${dna.active > 65 ? "YÜKSEK" : "ORTA"}\n**Gece aktivitesi:** ${dna.night > 20 ? "YÜKSEK" : "ORTA"}\n**Tahmin:** ${dna.night > 20 ? "22:00 sonrası hareketlilik bekleniyor." : "Gün içinde dengeli aktivite bekleniyor."}\n\n_Bu kesin bir tahmin değildir; geçmiş sunucu istatistiklerinden üretilir._`)] });
  }
  if (sub === "archive") {
    const counts = {
      üyeler: db.prepare("SELECT COUNT(*) AS n FROM users WHERE guild_id=?").get(guild.id).n,
      mesajlar: messageCount(guild.id),
      timeline: db.prepare("SELECT COUNT(*) AS n FROM timeline WHERE guild_id=?").get(guild.id).n,
      anomaliler: db.prepare("SELECT COUNT(*) AS n FROM anomalies WHERE guild_id=?").get(guild.id).n,
      sırlar: db.prepare("SELECT COUNT(*) AS n FROM secrets WHERE guild_id=?").get(guild.id).n,
      lore: db.prepare("SELECT COUNT(*) AS n FROM lore WHERE guild_id=?").get(guild.id).n,
      başarımlar: db.prepare("SELECT COUNT(*) AS n FROM user_achievements WHERE guild_id=?").get(guild.id).n,
    };
    return interaction.reply({ embeds: [embed("📚 ECHO ARCHIVE", Object.entries(counts).map(([k, v]) => `**${k}:** ${v}`).join("\n"))] });
  }
  if (sub === "ticket-panel") {
    return interaction.reply({ embeds: [embed("🎫 Destek Merkezi", "Destek almak için aşağıdaki butona bas.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("echo_ticket_open").setLabel("Ticket Aç").setEmoji("🎫").setStyle(ButtonStyle.Success))] });
  }
  if (sub === "basvuru-panel") {
    return interaction.reply({ embeds: [embed("📝 Yetkili Başvurusu", "Başvuru formunu açmak için aşağıdaki butona bas.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("echo_application_open").setLabel("Başvuru Yap").setStyle(ButtonStyle.Primary))] });
  }
  if (sub === "oneri-panel") {
    return interaction.reply({ embeds: [embed("💡 Öneri Kutusu", "Sunucuyu geliştirmek için önerini gönder.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("echo_suggestion_open").setLabel("Öneri Gönder").setStyle(ButtonStyle.Success))] });
  }
  if (sub === "dogrulama-panel") {
    return interaction.reply({ embeds: [embed("✅ Sunucu Doğrulaması", "Kuralları okuduysan doğrulanmış rolünü almak için butona bas.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("echo_verify").setLabel("Doğrula").setStyle(ButtonStyle.Success))] });
  }
  if (sub === "rol-panel") {
    const options = (process.env.SELF_ROLES || "").split(",").map((x) => x.trim().split(":")).filter((x) => x[0] && x[1] && guild.roles.cache.has(x[1])).slice(0, 25);
    if (!options.length) return replyError(interaction, "SELF_ROLES değişkenini `Oyun:ROL_ID,Platform:ROL_ID` formatında doldur.");
    const menu = new StringSelectMenuBuilder().setCustomId("echo_self_roles").setPlaceholder("Rol seç").setMinValues(0).setMaxValues(options.length).addOptions(options.map(([label, value]) => ({ label, value })));
    return interaction.reply({ embeds: [embed("🎭 Rol Menüsü", "İstediğin rolleri seç.")], components: [new ActionRowBuilder().addComponents(menu)] });
  }
  if (sub === "etkinlik") {
    const title = interaction.options.getString("baslik", true);
    const date = interaction.options.getString("tarih", true);
    const description = interaction.options.getString("aciklama", true);
    db.prepare("INSERT INTO events(guild_id,title,description,event_time,created_by,created_at) VALUES(?,?,?,?,?,?)").run(guild.id, title, description, date, user.id, now());
    addTimeline(guild.id, "event", "Etkinlik oluşturuldu", title);
    addWorldXp(guild.id, 35);
    return interaction.reply({ content: "@everyone", allowedMentions: { parse: ["everyone"] }, embeds: [embed(`📅 ${title}`, `${description}\n\n**Tarih:** ${date}`, "FAA61A")] });
  }
}

// ============================================================
// BUTTONS / MODALS / TICKETS
// ============================================================
async function handleButton(interaction) {
  const guild = interaction.guild;
  if (interaction.customId === "echo_verify") {
    let role = guild.roles.cache.find((r) => r.name === "Doğrulanmış");
    if (!role) role = await guild.roles.create({ name: "Doğrulanmış", color: "Blue", reason: "ECHO doğrulama" });
    await interaction.member.roles.add(role).catch(() => {});
    return interaction.reply({ embeds: [okEmbed("Doğrulama tamamlandı", "Doğrulanmış rolün verildi.")], ephemeral: true });
  }
  if (interaction.customId === "echo_ticket_open") {
    const existing = guild.channels.cache.find((c) => c.name === `ticket-${interaction.user.id}`);
    if (existing) return interaction.reply({ content: `Zaten açık ticket'ın var: ${existing}`, ephemeral: true });
    const category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === "TOPLULUK");
    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ],
    });
    await channel.send({ content: `${interaction.user}`, embeds: [embed("🎫 Ticket açıldı", "Sorununu yaz. Yetkili ekibi ilgilenecek.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("echo_ticket_close").setLabel("Ticket Kapat").setStyle(ButtonStyle.Danger))] });
    return interaction.reply({ content: `Ticket oluşturuldu: ${channel}`, ephemeral: true });
  }
  if (interaction.customId === "echo_ticket_close") {
    await interaction.reply("Ticket 5 saniye içinde kapatılıyor.");
    return setTimeout(() => interaction.channel.delete("ECHO ticket kapatma").catch(() => {}), 5000);
  }
  if (interaction.customId === "echo_application_open") {
    const modal = new ModalBuilder().setCustomId("echo_application_modal").setTitle("Yetkili Başvurusu");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("age").setLabel("Yaşın").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("experience").setLabel("Deneyimin").setStyle(TextInputStyle.Paragraph).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("why").setLabel("Neden seni seçelim?").setStyle(TextInputStyle.Paragraph).setRequired(true)),
    );
    return interaction.showModal(modal);
  }
  if (interaction.customId === "echo_suggestion_open") {
    const modal = new ModalBuilder().setCustomId("echo_suggestion_modal").setTitle("Öneri Gönder");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Başlık").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("body").setLabel("Önerin").setStyle(TextInputStyle.Paragraph).setRequired(true)),
    );
    return interaction.showModal(modal);
  }
}

async function handleModal(interaction) {
  const guild = interaction.guild;
  if (interaction.customId === "echo_application_modal") {
    const channel = getChannel(guild, "application_channel_id", ["basvurular"]);
    if (!channel) return replyError(interaction, "Başvuru kanalı bulunamadı.");
    await channel.send({ embeds: [embed("📝 Yeni Yetkili Başvurusu", `**Başvuran:** ${interaction.user}\n**Yaş:** ${interaction.fields.getTextInputValue("age")}\n**Deneyim:** ${interaction.fields.getTextInputValue("experience")}\n**Neden:** ${interaction.fields.getTextInputValue("why")}`, "FAA61A")] });
    return interaction.reply({ embeds: [okEmbed("Başvuru gönderildi", "Yetkili ekibine iletildi.")], ephemeral: true });
  }
  if (interaction.customId === "echo_suggestion_modal") {
    const channel = getChannel(guild, "suggestion_channel_id", ["oneriler"]);
    if (!channel) return replyError(interaction, "Öneri kanalı bulunamadı.");
    const message = await channel.send({ embeds: [embed(`💡 ${interaction.fields.getTextInputValue("title")}`, `${interaction.fields.getTextInputValue("body")}\n\nGönderen: ${interaction.user}`, "57F287")] });
    await message.react("✅").catch(() => {});
    await message.react("❌").catch(() => {});
    return interaction.reply({ embeds: [okEmbed("Öneri gönderildi", "Teşekkürler.")], ephemeral: true });
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    const timestamp = now();
    const hour = new Date().getHours();
    upsertUser(message.guild.id, message.author);
    const userUpdate = db.prepare("UPDATE users SET message_count=message_count+1,last_message_at=?,last_seen=?,night_messages=night_messages+? WHERE guild_id=? AND user_id=?");
    userUpdate.run(timestamp, timestamp, hour >= 23 || hour < 5 ? 1 : 0, message.guild.id, message.author.id);
    db.prepare("INSERT INTO hourly_activity(guild_id,hour,messages) VALUES(?,?,1) ON CONFLICT(guild_id,hour) DO UPDATE SET messages=messages+1").run(message.guild.id, hour);
    db.prepare("INSERT INTO channel_activity(guild_id,channel_id,channel_name,messages) VALUES(?,?,?,1) ON CONFLICT(guild_id,channel_id) DO UPDATE SET messages=messages+1,channel_name=excluded.channel_name").run(message.guild.id, message.channel.id, message.channel.name);
    const afk = db.prepare("SELECT * FROM afk WHERE guild_id=? AND user_id=?").get(message.guild.id, message.author.id);
    if (afk) await disableAfk(message.member, message.channel);
    for (const mentioned of message.mentions.users.values()) {
      const record = db.prepare("SELECT * FROM afk WHERE guild_id=? AND user_id=?").get(message.guild.id, mentioned.id);
      if (record && mentioned.id !== message.author.id) {
        const key = `afk_notice_${message.author.id}_${mentioned.id}`;
        const last = Number(getSetting(message.guild.id, key, 0));
        if (timestamp - last > 300) {
          setSetting(message.guild.id, key, timestamp);
          await message.reply({ embeds: [embed("💤 AFK bilgisi", `${mentioned.username} şu anda AFK.\n**Sebep:** ${record.reason}\n**Süre:** ${fmtDuration(timestamp - record.started_at)}`, "FAA61A")] }).catch(() => {});
        }
      }
    }
    const unlocked = checkAchievements(message.guild.id, message.author.id);
    if (unlocked.length) await message.channel.send({ embeds: [embed("🏆 Başarım açıldı", `${message.author} yeni başarım kazandı: **${unlocked.join(", ")}**`, "FEE75C")] }).catch(() => {});
    addWorldXp(message.guild.id, 1);
  } catch (error) {
    console.error("Mesaj işleme hatası:", error.message);
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!newState.guild || newState.member?.user.bot) return;
  if (!oldState.channelId && newState.channelId) {
    upsertUser(newState.guild.id, newState.member.user);
    db.prepare("UPDATE users SET voice_seconds=voice_seconds+60 WHERE guild_id=? AND user_id=?").run(newState.guild.id, newState.member.id);
    unlockAchievement(newState.guild.id, newState.member.id, "first_voice");
    addWorldXp(newState.guild.id, 2);
  }
});

client.on("guildMemberAdd", async (member) => {
  db.prepare("INSERT INTO member_changes(guild_id,user_id,type,created_at) VALUES(?,?,?,?)").run(member.guild.id, member.id, "join", now());
  upsertUser(member.guild.id, member.user);
  addTimeline(member.guild.id, "member", "Yeni üye", `${member.user.tag} sunucuya katıldı.`);
  const welcome = getChannel(member.guild, "welcome_channel_id", ["hos-geldin", "hoş-geldin"]);
  if (welcome) await welcome.send({ embeds: [embed("👋 Sunucumuza hoş geldin", `${member} aramıza katıldı. Şu anda **${member.guild.memberCount}** kişiyiz.\nKuralları okumayı unutma!`, "57F287")] }).catch(() => {});
  await sendLog(member.guild, "Yeni üye", `${member.user.tag} sunucuya katıldı.`, "57F287");
});

client.on("guildMemberRemove", async (member) => {
  db.prepare("INSERT INTO member_changes(guild_id,user_id,type,created_at) VALUES(?,?,?,?)").run(member.guild.id, member.id, "leave", now());
  addTimeline(member.guild.id, "member", "Üye ayrıldı", `${member.user.tag} sunucudan ayrıldı.`);
  await sendLog(member.guild, "Üye ayrıldı", `${member.user.tag} sunucudan ayrıldı.`, "ED4245");
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "e") return handleCommand(interaction);
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isModalSubmit()) return handleModal(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === "echo_self_roles") {
      const all = (process.env.SELF_ROLES || "").split(",").map((x) => x.trim().split(":")).filter((x) => x[1]);
      for (const [, roleId] of all) {
        if (interaction.values.includes(roleId)) await interaction.member.roles.add(roleId).catch(() => {});
        else await interaction.member.roles.remove(roleId).catch(() => {});
      }
      return interaction.reply({ content: "Rollerin güncellendi.", ephemeral: true });
    }
  } catch (error) {
    console.error("Interaction hatası:", error.message);
    await replyError(interaction, "Discord işlemi tamamlanamadı. Bot izinlerini kontrol et.");
  }
});

// ============================================================
// SCHEDULER / SECURITY / STARTUP
// ============================================================
let scheduler;
function startScheduler() {
  scheduler = setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      try {
        createSecret(guild.id);
        const anomaly = runAnomaly(guild);
        if (anomaly) sendLog(guild, "⚠️ ANOMALY DETECTED", anomaly, "ED4245");
        ensureLore(guild.id);
      } catch (error) {
        console.error("Scheduler hatası:", error.message);
      }
    }
  }, 15 * 60 * 1000);
}

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error?.message || error));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error?.message || error));
async function shutdown(signal) {
  console.log(`${signal}: ECHO güvenli şekilde kapanıyor...`);
  if (scheduler) clearInterval(scheduler);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

(async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: buildCommands() });
    await client.login(TOKEN);
    startScheduler();
    console.log("====================================");
    console.log("          ECHO DISCORD BOT");
    console.log("====================================");
    console.log(`Version: ${VERSION}`);
    console.log("Database: SQLite — ONLINE");
    console.log("AFK / Memory / Analytics: ONLINE");
    console.log("DNA / Anomaly / Secret / Lore: ONLINE");
    console.log("World / Achievement / Catch-up: ONLINE");
    console.log("====================================");
  } catch (error) {
    console.error("ECHO başlatılamadı:", error.message);
    db.close();
    process.exit(1);
  }
})();
