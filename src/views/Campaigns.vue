<template>
  <div class="campaigns">
    <header>
      <h1>Grimoire</h1>
      <button @click="showCreate = true">+ New Campaign</button>
    </header>

    <!-- Create campaign modal -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <div class="modal">
        <h2>New Campaign</h2>
        <input v-model="newTitle" placeholder="Campaign name" @keyup.enter="create" />
        <textarea v-model="newDesc" placeholder="Description (optional)" rows="3" />
        <div class="modal-actions">
          <button class="ghost" @click="showCreate = false">Cancel</button>
          <button @click="create" :disabled="!newTitle.trim()">Create</button>
        </div>
      </div>
    </div>

    <ul v-if="campaigns.length">
      <li v-for="c in campaigns" :key="c.id" class="campaign-card">
        <div class="card-header">
          <div class="meta">
            <strong>{{ c.title }}</strong>
            <p>{{ c.description || 'No description' }}</p>
          </div>
          <div class="card-actions">
            <button class="ghost small" @click="toggleManage(c.id)">
              {{ managing === c.id ? '▲ Close' : '⚙ Manage' }}
            </button>
            <button class="ghost small danger" title="Delete campaign" @click="deleteCampaign(c)">🗑</button>
          </div>
        </div>

        <!-- Scenes row -->
        <div class="scenes">
          <button
            v-for="s in scenesByCampaign[c.id] || []"
            :key="s.id"
            @click="open(c, s)">
            {{ s.name }} <em>{{ s.mode }}</em>
          </button>
          <button class="ghost" @click="addScene(c)">+ scene</button>
        </div>

        <!-- Session management panel -->
        <div v-if="managing === c.id" class="manage-panel">

          <!-- Players roster -->
          <section class="manage-section">
            <h3>Players</h3>
            <ul class="player-list" v-if="roster[c.id]?.length">
              <li v-for="p in roster[c.id]" :key="p.uid">
                <span class="player-meta">
                  <span class="player-name">{{ p.displayName }}</span>
                  <span class="player-uid">{{ p.uid }}</span>
                  <span v-if="!p.exists" class="player-flag err">account missing</span>
                  <span v-else-if="!p.hasEmail" class="player-flag warn">no email</span>
                </span>
                <span class="player-actions">
                  <button
                    class="ghost small"
                    :disabled="!p.hasEmail || !campaignData[c.id]?.sessionAt || sending[p.uid]"
                    :title="!p.hasEmail ? 'This player has no email address set' : (!campaignData[c.id]?.sessionAt ? 'Pick a session time first' : 'Send this player a reminder')"
                    @click="sendReminder(c, p.uid)">
                    {{ sending[p.uid] ? '…' : '📧' }}
                  </button>
                  <button class="ghost small danger" @click="removePlayer(c, p.uid)">✕</button>
                </span>
              </li>
            </ul>
            <p v-else class="empty-note">No players invited yet.</p>

            <div class="invite-row">
              <input
                v-model="inviteSearch[c.id]"
                placeholder="Search for a user to invite…"
                @input="searchUsers(c.id)"
                @keyup.escape="userResults[c.id] = []"
              />
              <ul v-if="userResults[c.id]?.length" class="user-dropdown">
                <li
                  v-for="u in userResults[c.id]" :key="u.uid"
                  @click="addPlayer(c, u)">
                  <strong>{{ u.displayName }}</strong> <span class="dim">{{ u.uid }}</span>
                </li>
              </ul>
            </div>
            <p v-if="inviteFlash[c.id]" class="remind-status" :class="inviteFlash[c.id].ok ? 'ok' : 'err'">
              {{ inviteFlash[c.id].msg }}
            </p>
          </section>
          <section class="manage-section">
            <h3>Next Session</h3>
            <div class="session-row">
              <input
                type="datetime-local"
                :value="campaignData[c.id]?.sessionAt"
                @change="setSessionAt(c, $event.target.value)"
              />
              <button
                @click="sendReminder(c)"
                :disabled="!campaignData[c.id]?.sessionAt || !roster[c.id]?.length || sending[c.id]"
                class="remind-btn">
                {{ sending[c.id] ? 'Sending…' : '📧 Remind All' }}
              </button>
            </div>
            <p class="help-text" v-if="!roster[c.id]?.length">
              Add at least one player to send reminders.
            </p>
            <p class="help-text" v-else-if="!campaignData[c.id]?.sessionAt">
              Pick a session date/time first.
            </p>
            <p v-if="reminderStatus[c.id]" class="remind-status" :class="reminderStatus[c.id].ok ? 'ok' : 'err'">
              {{ reminderStatus[c.id].msg }}
            </p>
          </section>

          <!-- Discord webhook -->
          <section class="manage-section">
            <h3>Discord</h3>
            <p class="status-line">
              <span :class="discordConfig[c.id]?.hasWebhook ? 'on-dot' : 'off-dot'" />
              {{ discordConfig[c.id]?.hasWebhook ? 'Webhook connected' : 'No webhook set' }}
            </p>
            <input
              class="webhook-input"
              type="password"
              :placeholder="discordConfig[c.id]?.hasWebhook ? 'Enter a new webhook URL to replace…' : 'Paste Discord webhook URL…'"
              v-model="discordConfig[c.id]._newUrl"
            />
            <div class="discord-events">
              <label><input type="checkbox" v-model="discordConfig[c.id].events.reminder" /> Session reminders</label>
              <label><input type="checkbox" v-model="discordConfig[c.id].events.dice" /> Dice rolls</label>
              <label><input type="checkbox" v-model="discordConfig[c.id].events.join" /> Player joins</label>
            </div>
            <div class="discord-actions">
              <button class="remind-btn" @click="saveDiscord(c)">Save</button>
              <button v-if="discordConfig[c.id]?.hasWebhook" class="ghost small danger" @click="clearDiscord(c)">Remove webhook</button>
            </div>
            <p v-if="discordStatus[c.id]" class="remind-status" :class="discordStatus[c.id].ok ? 'ok' : 'err'">
              {{ discordStatus[c.id].msg }}
            </p>
          </section>

        </div>
      </li>
    </ul>
    <p v-else class="empty">No campaigns yet. Create one to start playing.</p>
  </div>
</template>

<script>
import axios from '@nextcloud/axios';
import { generateUrl } from '../lib/url.js';

export default {
  name: 'Campaigns',
  data() {
    return {
      campaigns: [],
      scenesByCampaign: {},
      campaignData: {},     // { [id]: { players: [], sessionAt: '' } }
      roster: {},           // { [id]: [{uid, displayName, hasEmail, exists}] }
      discordConfig: {},    // { [id]: { hasWebhook, events, _newUrl } }
      discordStatus: {},
      managing: null,
      showCreate: false,
      newTitle: '',
      newDesc: '',
      inviteSearch: {},
      userResults: {},
      _searchTimer: {},
      sending: {},
      reminderStatus: {},
      inviteFlash: {},
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    api(path) { return generateUrl('/apps/grimoire/api' + path); },

    flash(id, msg, ok = true) {
      this.inviteFlash[id] = { msg, ok };
      clearTimeout(this._flashTimer?.[id]);
      this._flashTimer = this._flashTimer || {};
      this._flashTimer[id] = setTimeout(() => { this.inviteFlash[id] = null; }, 4000);
    },

    async deleteCampaign(c) {
      if (!confirm(`Delete campaign "${c.title}" and all its scenes? This cannot be undone.`)) return;
      try {
        await axios.delete(this.api(`/campaigns/${c.id}`));
        this.campaigns = this.campaigns.filter((x) => x.id !== c.id);
        if (this.managing === c.id) this.managing = null;
      } catch {
        alert('Failed to delete campaign.');
      }
    },

    async load() {
      const { data } = await axios.get(this.api('/campaigns'));
      this.campaigns = data;
      for (const c of data) {
        const res = await axios.get(this.api(`/campaigns/${c.id}/scenes`));
        this.scenesByCampaign[c.id] = res.data;
        // Deserialise stored session data from the campaign's data field.
        let parsed = {};
        try { parsed = JSON.parse(c.data || '{}'); } catch { parsed = {}; }
        if (!parsed.players) parsed.players = [];
        this.campaignData[c.id] = parsed;
        // Discord config arrives pre-sanitised (hasWebhook + events, no URL).
        this.discordConfig[c.id] = {
          hasWebhook: parsed.discord?.hasWebhook || false,
          events: parsed.discord?.events || {},
          _newUrl: '',
        };
      }
    },

    async create() {
      if (!this.newTitle.trim()) return;
      await axios.post(this.api('/campaigns'), {
        title: this.newTitle.trim(),
        description: this.newDesc.trim(),
      });
      this.newTitle = '';
      this.newDesc = '';
      this.showCreate = false;
      this.load();
    },

    async addScene(c) {
      const name = prompt('Scene name?');
      if (!name) return;
      const mode = confirm('3D scene? (Cancel = 2D)') ? '3d' : '2d';
      await axios.post(this.api(`/campaigns/${c.id}/scenes`), { name, mode });
      this.load();
    },

    open(c, s) {
      this.$router.push({ name: 'room', params: { campaignId: c.id, sceneId: s.id } });
    },

    toggleManage(id) {
      this.managing = this.managing === id ? null : id;
      if (this.managing === id) this.loadRoster(id);
    },

    // --- Player management ---

    async searchUsers(campaignId) {
      const q = (this.inviteSearch[campaignId] || '').trim();
      clearTimeout(this._searchTimer[campaignId]);
      if (q.length < 2) { this.userResults[campaignId] = []; return; }
      this._searchTimer[campaignId] = setTimeout(async () => {
        try {
          // Use our own endpoint (works for any user) instead of the
          // admin-only provisioning API.
          const { data } = await axios.get(this.api('/users/search'), {
            params: { q, limit: 8 },
          });
          const existing = this.campaignData[campaignId]?.players || [];
          // data is [{uid, displayName}]; filter out already-invited players.
          this.userResults[campaignId] = data.filter((u) => !existing.includes(u.uid));
        } catch {
          this.userResults[campaignId] = [];
        }
      }, 300);
    },

    async addPlayer(campaign, user) {
      const uid = typeof user === 'string' ? user : user.uid;
      const name = typeof user === 'string' ? user : (user.displayName || user.uid);
      const cd = this.campaignData[campaign.id];
      if (!cd.players.includes(uid)) cd.players.push(uid);
      this.inviteSearch[campaign.id] = '';
      this.userResults[campaign.id] = [];
      await this._saveCampaignData(campaign);
      await this.loadRoster(campaign.id);
      this.flash(campaign.id, `${name} added to the campaign.`, true);
    },

    async removePlayer(campaign, uid) {
      const cd = this.campaignData[campaign.id];
      cd.players = cd.players.filter((u) => u !== uid);
      await this._saveCampaignData(campaign);
      await this.loadRoster(campaign.id);
    },

    /** Load the roster (display names + email availability) for a campaign. */
    async loadRoster(campaignId) {
      try {
        const { data } = await axios.get(this.api(`/campaigns/${campaignId}/players`));
        this.roster[campaignId] = data;
      } catch {
        this.roster[campaignId] = [];
      }
    },

    // --- Session scheduling ---

    async setSessionAt(campaign, value) {
      this.campaignData[campaign.id].sessionAt = value || null;
      await this._saveCampaignData(campaign);
    },

    async sendReminder(campaign, playerUid = '') {
      const key = playerUid || campaign.id;
      this.sending[key] = true;
      this.reminderStatus[campaign.id] = null;
      try {
        const { data } = await axios.post(this.api(`/campaigns/${campaign.id}/remind`), {
          sessionAt: this.campaignData[campaign.id].sessionAt,
          message: `Your next ${campaign.title} session is scheduled. See you there!`,
          player: playerUid,
        });
        const who = playerUid ? `${playerUid}` : `${data.sent.length} player(s)`;
        let msg = `Reminder sent to ${who}.`;
        if (data.skipped?.length) msg += ` Skipped: ${data.skipped.join(', ')}.`;
        if (data.discordPosted) msg += ' Posted to Discord.';
        this.reminderStatus[campaign.id] = { ok: true, msg };
      } catch (e) {
        const msg = e?.response?.data?.error || 'Failed to send reminder.';
        this.reminderStatus[campaign.id] = { ok: false, msg };
      } finally {
        this.sending[key] = false;
        setTimeout(() => { this.reminderStatus[campaign.id] = null; }, 6000);
      }
    },

    // --- Discord webhook config ---

    async saveDiscord(campaign) {
      const d = this.discordConfig[campaign.id] || { events: {} };
      try {
        const { data } = await axios.put(this.api(`/campaigns/${campaign.id}/discord`), {
          // Empty string leaves the existing URL untouched; the field is only
          // sent when the user actually typed a new one.
          webhookUrl: d._newUrl || '',
          events: d.events || {},
        });
        // Server returns the public view (hasWebhook + events), no URL.
        this.discordConfig[campaign.id] = { ...data, _newUrl: '' };
        this.discordStatus[campaign.id] = { ok: true, msg: 'Discord settings saved.' };
      } catch {
        this.discordStatus[campaign.id] = { ok: false, msg: 'Failed to save Discord settings.' };
      }
      setTimeout(() => { this.discordStatus[campaign.id] = null; }, 5000);
    },

    async clearDiscord(campaign) {
      try {
        const { data } = await axios.put(this.api(`/campaigns/${campaign.id}/discord`), {
          webhookUrl: '__CLEAR__',
          events: this.discordConfig[campaign.id]?.events || {},
        });
        this.discordConfig[campaign.id] = { ...data, _newUrl: '' };
        this.discordStatus[campaign.id] = { ok: true, msg: 'Webhook removed.' };
      } catch {
        this.discordStatus[campaign.id] = { ok: false, msg: 'Failed to remove webhook.' };
      }
      setTimeout(() => { this.discordStatus[campaign.id] = null; }, 5000);
    },

    async _saveCampaignData(campaign) {
      const c = this.campaigns.find((x) => x.id === campaign.id);
      await axios.put(this.api(`/campaigns/${campaign.id}`), {
        title: c.title,
        description: c.description || '',
        data: JSON.stringify(this.campaignData[campaign.id]),
      });
    },
  },
};
</script>

<style scoped>
.campaigns { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
h1 { color: var(--g-primary, #0082c9); letter-spacing: .04em; margin: 0; font-size: 22px; }

/* Modals */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex;
  align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; padding: 28px; min-width: 360px; display: flex; flex-direction: column; gap: 12px; }
.modal h2 { margin: 0; color: var(--g-primary, #0082c9); }
.modal input, .modal textarea {
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border, #2d3748);
  border-radius: var(--g-radius, 8px); color: var(--g-text, #d8dde4); padding: 8px 12px;
  font: inherit; width: 100%; box-sizing: border-box; }
.modal input:focus, .modal textarea:focus { outline: none; border-color: var(--g-primary, #0082c9); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }

/* Campaign cards */
ul { list-style: none; padding: 0; }
.campaign-card { border: 1px solid var(--g-border, #2d3748);
  border-radius: 12px; padding: 18px; margin: 12px 0;
  background: var(--g-bg-dark, #0f1318); }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.meta strong { color: var(--g-text, #d8dde4); font-size: 16px; }
.meta p { color: var(--g-text-dim, #8b949e); margin: 4px 0 0; font-size: 13px; }
.card-actions { flex-shrink: 0; }

.scenes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.scenes button { background: var(--g-bg-card, #1e2430); color: var(--g-text, #d8dde4);
  border: 1px solid var(--g-border, #2d3748); border-radius: var(--g-radius, 8px);
  padding: 7px 12px; cursor: pointer; font: inherit; }
.scenes button:hover { border-color: var(--g-primary, #0082c9); }
.scenes button em { color: var(--g-primary, #0082c9); font-size: 11px; margin-left: 4px; }

/* Manage panel */
.manage-panel { margin-top: 18px; border-top: 1px solid var(--g-border, #2d3748);
  padding-top: 18px; display: flex; flex-wrap: wrap; gap: 24px; }
.manage-section { flex: 1; min-width: 220px; }
.manage-section h3 { color: var(--g-primary, #0082c9); margin: 0 0 12px; font-size: 11px;
  text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }

/* Player list */
.player-list { padding: 0; margin: 0 0 10px; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.player-list li { display: flex; align-items: center; justify-content: space-between;
  background: var(--g-bg-card, #1e2430); border: 1px solid var(--g-border-dk, #1e2a3a);
  border-radius: var(--g-radius, 8px); padding: 6px 10px; }
.player-uid { color: var(--g-text, #d8dde4); font-size: 13px; }
.player-meta { display: flex; flex-direction: column; gap: 1px; }
.player-name { color: var(--g-text, #d8dde4); font-size: 13px; font-weight: 600; }
.player-meta .player-uid { color: var(--g-text-dim, #8b949e); font-size: 11px; }
.player-flag { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; }
.player-flag.warn { color: #e0a458; }
.player-flag.err { color: #e74c3c; }
.player-actions { display: flex; gap: 4px; align-items: center; }
.player-actions button:disabled { opacity: .35; cursor: default; }

/* Discord section */
.status-line { display: flex; align-items: center; gap: 8px; font-size: 13px;
  color: var(--g-text, #d8dde4); margin: 0 0 10px; }
.on-dot, .off-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.on-dot { background: #57c17e; box-shadow: 0 0 6px #57c17e; }
.off-dot { background: var(--g-text-dim, #8b949e); }
.webhook-input { width: 100%; box-sizing: border-box; background: var(--g-bg-card, #1e2430);
  border: 1px solid var(--g-border, #2d3748); border-radius: var(--g-radius, 8px);
  color: var(--g-text, #d8dde4); padding: 7px 10px; font: inherit; font-size: 12px; }
.webhook-input:focus { outline: none; border-color: var(--g-primary, #0082c9); }
.discord-events { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.discord-events label { display: flex; align-items: center; gap: 8px; font-size: 13px;
  color: var(--g-text, #d8dde4); cursor: pointer; }
.discord-actions { display: flex; align-items: center; gap: 10px; }
.user-dropdown .dim { color: var(--g-text-dim, #8b949e); font-size: 11px; }

/* Invite search */
.invite-row { position: relative; }
.invite-row input { width: 100%; box-sizing: border-box; background: var(--g-bg-card, #1e2430);
  border: 1px solid var(--g-border, #2d3748); border-radius: var(--g-radius, 8px);
  color: var(--g-text, #d8dde4); padding: 7px 10px; font: inherit; }
.invite-row input:focus { outline: none; border-color: var(--g-primary, #0082c9); }
.user-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--g-bg-dark, #0f1318); border: 1px solid var(--g-border, #2d3748);
  border-radius: var(--g-radius, 8px); padding: 4px 0;
  list-style: none; margin: 0; z-index: 50; max-height: 200px; overflow-y: auto; }
.user-dropdown li { padding: 8px 12px; color: var(--g-text, #d8dde4); cursor: pointer; font-size: 13px; }
.user-dropdown li:hover { background: var(--g-bg-card, #1e2430); }

/* Session row */
.session-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.session-row input[type="datetime-local"] { background: var(--g-bg-card, #1e2430);
  border: 1px solid var(--g-border, #2d3748); border-radius: var(--g-radius, 8px);
  color: var(--g-text, #d8dde4); padding: 7px 10px; font: inherit; color-scheme: dark; }
.remind-btn { background: var(--g-primary, #0082c9); border: none;
  border-radius: var(--g-radius, 8px); color: #fff; padding: 7px 14px;
  cursor: pointer; font: inherit; font-weight: 600; white-space: nowrap; }
.remind-btn:hover:not(:disabled) { opacity: .88; }
.remind-btn:disabled { opacity: .4; cursor: default; }
.help-text { color: var(--g-text-dim, #8b949e); font-size: 12px; margin: 8px 0 0; }
.remind-status { font-size: 13px; margin: 8px 0 0; font-weight: 600; }
.remind-status.ok { color: #57c17e; }
.remind-status.err { color: #e74c3c; }
.empty-note { color: var(--g-text-dim, #8b949e); font-size: 13px; margin: 0 0 8px; }

/* Shared buttons */
button { font: inherit; cursor: pointer; }
button.ghost { background: transparent; color: var(--g-text-dim, #8b949e);
  border: 1px solid var(--g-border, #2d3748); border-radius: var(--g-radius, 8px); padding: 6px 12px; }
button.ghost:hover { color: var(--g-text, #d8dde4); border-color: var(--g-primary, #0082c9); }
button.small { padding: 3px 8px; font-size: 12px; }
button.danger { color: #e74c3c; border-color: transparent; }
button.danger:hover { color: #ff6b6b; }
header > button { color: var(--g-primary-t, #fff); background: var(--g-primary, #0082c9);
  border: none; border-radius: var(--g-radius, 8px); padding: 8px 16px; font-weight: 600; }
header > button:hover { opacity: .88; }
.empty { color: var(--g-text-dim, #8b949e); text-align: center; margin-top: 60px; }
</style>
