import { Download, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AmirOSUpdateStatus } from "../types";

const DISMISSED_UPDATE_KEY = "amiros.update.dismissed";

type UpdatePromptProps = {
  update?: AmirOSUpdateStatus;
  onStartUpdate: () => Promise<void>;
};

export function UpdatePrompt({ update, onStartUpdate }: UpdatePromptProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string>();
  const latestVersion = update?.latestVersion;

  useEffect(() => {
    if (update?.status !== "available" || !latestVersion) return;
    if (window.sessionStorage.getItem(DISMISSED_UPDATE_KEY) !== latestVersion) setOpen(true);
  }, [latestVersion, update?.status]);

  if (!open || update?.status !== "available" || !latestVersion) return null;

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISSED_UPDATE_KEY, latestVersion);
    setOpen(false);
  };

  const start = async () => {
    setUpdating(true);
    setError(undefined);
    try {
      await onStartUpdate();
    } catch (actionError) {
      setUpdating(false);
      setError(actionError instanceof Error ? actionError.message : "AmirOS could not start the update.");
    }
  };

  return <div className="release-experience-backdrop" role="presentation">
    <section className="release-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="amiros-update-title">
      <header>
        <span className="release-dialog-icon"><Download size={24} /></span>
        <div><small>New AmirOS version available</small><h2 id="amiros-update-title">Update to v{latestVersion}</h2></div>
        {!updating ? <button className="icon-button" type="button" aria-label="Update later" onClick={dismiss}><X size={18} /></button> : null}
      </header>
      <div className="release-notes-body update-body">
        {updating ? <div className="update-progress"><LoaderCircle className="spin" size={21} /><div><strong>Starting your update…</strong><p>AmirOS will briefly restart, then reopen the dashboard automatically.</p></div></div> : <>
          <p className="update-intro">A newer version is ready. Update from here—no Finder steps, downloads, or manual file swapping.</p>
          <div className="update-safety"><ShieldCheck size={20} /><div><strong>Your private data stays on this Mac</strong><p>AmirOS makes a backup of your WhatsApp link, API key, knowledge, calendar, settings, and profile before updating, then restores everything automatically.</p></div></div>
          <p className="update-quiet-note">A Terminal window opens only to show progress. If the update cannot be downloaded, AmirOS stays running as it is.</p>
        </>}
        {error ? <p className="update-error" role="alert">{error}</p> : null}
      </div>
      <footer>
        {!updating ? <><button className="button compact ghost" type="button" onClick={dismiss}>Later</button><button className="button primary compact" type="button" onClick={() => void start()}><Download size={16} /> Update AmirOS</button></> : null}
      </footer>
    </section>
  </div>;
}
