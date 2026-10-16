<template>
  <div>
    <a-select-input
      :label="i18n.theme"
      v-model="theme"
      style="margin-left: 10px"
    >
      <option value="normal">{{ i18n.theme_light }}</option>
      <option value="dark">{{ i18n.theme_dark }}</option>
      <option value="simple">{{ i18n.theme_simple }}</option>
      <option value="compact">{{ i18n.theme_compact }}</option>
      <option value="accessibility">{{ i18n.theme_high_contrast }}</option>
      <option value="flat">{{ i18n.theme_flat }}</option>
    </a-select-input>
    <a-select-input
      :label="i18n.scale"
      v-model="zoom"
      style="margin-left: 10px"
    >
      <option value="125">125%</option>
      <option value="100">100%</option>
      <option value="90">90%</option>
      <option value="80">80%</option>
      <option value="67">67%</option>
      <option value="57">57%</option>
      <option value="50">50%</option>
      <option value="40">40%</option>
      <option value="33">33%</option>
      <option value="25">25%</option>
      <option value="20">20%</option>
    </a-select-input>
    <a-toggle-input :label="i18n.use_autofill" v-model="useAutofill" />
    <a-select-input
      :label="i18n.autofill_site + ' ' + autofillSite.host"
      :value="autofillEntry"
      @input="setAutofillEntry"
      style="margin-left: 10px"
      v-if="isSupported && autofillSite"
    >
      <option value="">{{ i18n.autofill_site_off }}</option>
      <option
        v-for="entry in autofillCandidates"
        :key="entry.hash"
        :value="entry.hash"
      >
        {{ getEntryLabel(entry) }}
      </option>
    </a-select-input>
    <a-toggle-input
      :label="i18n.browser_sync"
      v-model="browserSync"
      :disabled="storageArea"
      @change="migrateStorage()"
    />
    <a-toggle-input :label="i18n.smart_filter" v-model="smartFilter" />
    <a-toggle-input
      :label="i18n.enable_context_menu"
      v-model="enableContextMenu"
      @change="requireContextMenuPermission()"
      v-if="isSupported"
    />
    <div class="control-group" v-show="!!defaultEncryption">
      <label class="combo-label">{{ i18n.autolock }}</label>
      <input
        class="input"
        type="number"
        min="0"
        style="width: 70px; text-align: center"
        v-model="autolock"
        :disabled="Boolean(enforceAutolock)"
      />
      <span class="combo-label" style="margin-left: 0; margin-right: 20px">{{
        i18n.minutes
      }}</span>
    </div>
    <a-button @click="popOut()">{{ i18n.popout }}</a-button>
  </div>
</template>
<script lang="ts">
import Vue from "vue";
import { isFirefox, isSafari } from "../../browser";
import { UserSettings } from "../../models/settings";
import { OTPEntry, OTPType } from "../../models/otp";
import {
  getAutofillOrigin,
  getAutofillPermission,
  getAutofillSites,
  setAutofillSite,
} from "../../models/autofill";
import { getCurrentTab } from "../../utils";

export default Vue.extend({
  computed: {
    zoom: {
      get(): number {
        return this.$store.state.menu.zoom;
      },
      set(zoom: number) {
        this.$store.commit("menu/setZoom", zoom);
      },
    },
    useAutofill: {
      get(): boolean {
        return this.$store.state.menu.useAutofill;
      },
      set(useAutofill: boolean) {
        this.$store.commit("menu/setAutofill", useAutofill);
      },
    },
    smartFilter: {
      get(): boolean {
        return this.$store.state.menu.smartFilter;
      },
      set(smartFilter: boolean) {
        this.$store.commit("menu/setSmartFilter", smartFilter);
        this.$store.commit(
          "notification/alert",
          this.i18n.activate_auto_filter
        );
      },
    },
    enableContextMenu: {
      get(): boolean {
        return this.$store.state.menu.enableContextMenu;
      },
      set(enableContextMenu: boolean) {
        this.$store.commit("menu/setEnableContextMenu", enableContextMenu);
      },
    },
    theme: {
      get(): string {
        return this.$store.state.menu.theme;
      },
      set(theme: string) {
        this.$store.commit("menu/setTheme", theme);
      },
    },
    defaultEncryption(): string {
      return this.$store.state.accounts.defaultEncryption;
    },
    enforceAutolock() {
      return this.$store.state.menu.enforceAutolock;
    },
    autolock: {
      get(): number {
        if (this.$store.state.menu.enforceAutolock) {
          return this.$store.state.menu.enforceAutolock;
        } else {
          return this.$store.state.menu.autolock;
        }
      },
      set(autolock: number) {
        this.$store.commit("menu/setAutolock", autolock);
        chrome.runtime.sendMessage({ action: "resetAutolock" });
      },
    },
    storageArea() {
      return this.$store.state.menu.storageArea;
    },
    browserSync: {
      get(): boolean {
        return this.newStorageLocation === "sync";
      },
      set(value) {
        this.newStorageLocation = value ? "sync" : "local";
      },
    },
    isSupported: {
      get(): boolean {
        return !isFirefox && !isSafari;
      },
    },
    autofillCandidates(): OTPEntry[] {
      const matchedEntries: string[] =
        this.$store.getters["accounts/matchedEntries"] || [];
      const entries: OTPEntry[] = this.$store.state.accounts.entries.filter(
        (entry: OTPEntry) =>
          entry.type !== OTPType.hotp && entry.type !== OTPType.hhex
      );
      // Entries matching the current site first
      return [
        ...entries.filter((entry) => matchedEntries.includes(entry.hash)),
        ...entries.filter((entry) => !matchedEntries.includes(entry.hash)),
      ];
    },
  },
  data(): {
    newStorageLocation: string;
    autofillSite: { origin: string; host: string } | null;
    autofillEntry: string;
  } {
    return {
      newStorageLocation: "",
      autofillSite: null,
      autofillEntry: "",
    };
  },
  created() {
    this.loadAutofillSite();

    UserSettings.updateItems().then(() => {
      this.newStorageLocation =
        this.$store.state.menu.storageArea ||
        UserSettings.items.storageLocation;
    });
  },
  methods: {
    popOut() {
      let windowType;
      if (isFirefox) {
        windowType = "detached_panel";
      } else {
        windowType = "panel";
      }
      chrome.windows.create({
        url: chrome.runtime.getURL("view/popup.html?popup=true"),
        type: windowType as chrome.windows.createTypeEnum,
        height: window.innerHeight,
        width: window.innerWidth,
      });
    },
    migrateStorage() {
      this.$store.commit("currentView/changeView", "LoadingPage");
      this.$store
        .dispatch("accounts/migrateStorage", this.newStorageLocation)
        .then((m) => {
          this.$store.commit("notification/alert", this.i18n[m]);
          this.$store.commit("currentView/changeView", "PreferencesPage");
        }),
        (r: string) => {
          this.$store.commit("notification/alert", this.i18n.updateFailure + r);
          this.$store.commit("currentView/changeView", "PreferencesPage");
        };
    },
    async loadAutofillSite() {
      const tab = await getCurrentTab();
      const origin = getAutofillOrigin(tab?.url);
      if (!origin) {
        return;
      }

      const hash = (await getAutofillSites())[origin];
      const granted =
        !!hash &&
        (await chrome.permissions.contains(getAutofillPermission(origin)));
      this.autofillEntry = granted ? hash : "";
      this.autofillSite = { origin, host: new URL(origin).host };
    },
    getEntryLabel(entry: OTPEntry) {
      const issuer = entry.issuer.split("::")[0];
      return entry.account ? `${issuer} (${entry.account})` : issuer;
    },
    setAutofillEntry(hash: string) {
      const site = this.autofillSite;
      if (!site) {
        return;
      }

      const permission = getAutofillPermission(site.origin);
      const update = async (newHash: string) => {
        this.autofillEntry = newHash;
        await setAutofillSite(site.origin, newHash || null);
        chrome.runtime.sendMessage({ action: "updateAutofillSites" });
      };

      if (!hash) {
        // Keep permissions that backup providers need as well
        const usedByBackup = (
          chrome.runtime.getManifest().optional_host_permissions || []
        ).some(
          (host: string) =>
            host !== "https://*/*" && host.startsWith(site.origin)
        );
        if (usedByBackup) {
          update("");
        } else {
          chrome.permissions.remove(permission, () => update(""));
        }
        return;
      }

      // Has to be called right away, it needs the user gesture
      chrome.permissions.request(permission, (granted) => {
        if (granted) {
          update(hash);
        } else {
          // Reset the select to the previous value
          const previous = this.autofillEntry;
          this.autofillEntry = hash;
          this.$nextTick(() => {
            this.autofillEntry = previous;
          });
        }
      });
    },
    requireContextMenuPermission() {
      chrome.permissions.request(
        {
          permissions: ["contextMenus"],
        },
        (granted) => {
          if (!granted) {
            this.enableContextMenu = false;
            return;
          }
          chrome.runtime.sendMessage({
            action: "updateContextMenu",
          });
        }
      );
    },
  },
});
</script>
