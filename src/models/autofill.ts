import { UserSettings } from "./settings";

const contentScriptId = "authenticator-autofill";

export function getAutofillOrigin(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    const { protocol, origin } = new URL(url);
    // Only allow https, so codes are never sent to a page over plain http
    return protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}

export function getAutofillPermission(origin: string) {
  return { origins: [`${origin}/*`] };
}

export async function getAutofillSites() {
  await UserSettings.updateItems();
  return UserSettings.items.autofillSites || {};
}

export async function setAutofillSite(origin: string, hash: string | null) {
  const sites = await getAutofillSites();
  if (hash) {
    sites[origin] = hash;
  } else {
    delete sites[origin];
  }
  UserSettings.items.autofillSites = sites;
  await UserSettings.commitItems();
}

// Register the auto-fill content script for all enabled sites that still
// have their host permission
export async function syncAutofillContentScripts() {
  const sites = await getAutofillSites();
  const matches: string[] = [];
  for (const origin of Object.keys(sites)) {
    const permission = getAutofillPermission(origin);
    if (await chrome.permissions.contains(permission)) {
      matches.push(...permission.origins);
    }
  }

  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [contentScriptId],
  });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] });
  }

  if (matches.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: contentScriptId,
        matches,
        js: ["dist/autofill.js"],
        runAt: "document_idle",
        allFrames: false,
      },
    ]);
  }
}
