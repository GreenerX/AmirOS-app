import { AlertTriangle, Brain, Check, ChevronDown, Heart, LifeBuoy, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { firstRunPeopleProgressLabel, firstRunSelectedPeopleTracking, FIRST_RUN_PEOPLE_SCAN_LIMIT, FIRST_RUN_PEOPLE_SUGGESTION_LIMIT, suggestedFirstRunPeople, type FirstRunPeopleBuildResult } from "../onboarding-people";
import { derivePeopleGuidePhase, guideState, readPeopleGuideState, savePeopleGuideState, type PeopleGuidePhase, type PeopleGuideState } from "../people-guide-state";
import type { ChatSummary, DashboardData, KnowledgeTrackingStatus } from "../types";

type PeopleGettingStartedProps = {
  active: boolean;
  apiKeyConfigured: boolean;
  connection: DashboardData["connection"];
  chats: ChatSummary[];
  ownerName: string;
  onRefresh: () => Promise<void>;
  onBuild: (chatIds: string[], futureTracking: KnowledgeTrackingStatus, onProgress: (completed: number, total: number) => void) => Promise<FirstRunPeopleBuildResult>;
  onOpenProfile: (chatId: string) => void;
  onOpenHelp: () => void;
  onDeferred?: () => void;
  /** Opens directly into the explicit chooser when launched from the product tour. */
  startSelecting?: boolean;
};

export function PeopleGettingStarted({ active, apiKeyConfigured, connection, chats, ownerName, onRefresh, onBuild, onOpenProfile, onOpenHelp, onDeferred, startSelecting = false }: PeopleGettingStartedProps) {
  const [stored, setStored] = useState<PeopleGuideState | undefined>(() => readPeopleGuideState());
  const [selectedIds, setSelectedIds] = useState<string[]>(() => readPeopleGuideState()?.selectedChatIds || []);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const buildInFlight = useRef(false);
  const suggestedPeople = useMemo(() => suggestedFirstRunPeople(chats, ownerName), [chats, ownerName]);
  const phase = derivePeopleGuidePhase({
    onboardingComplete: active,
    apiKeyConfigured,
    connectionStatus: connection.status,
    chatCount: chats.length,
    suggestedPeopleCount: suggestedPeople.length,
  }, stored);

  useEffect(() => {
    const candidateIds = new Set(suggestedPeople.map((chat) => chat.id));
    setSelectedIds((current) => current.filter((id) => candidateIds.has(id)));
  }, [suggestedPeople]);

  const persist = (next: PeopleGuideState | undefined) => {
    if (next) savePeopleGuideState(next);
    setStored(next);
  };

  useEffect(() => {
    if (!startSelecting || !active || !apiKeyConfigured || connection.status !== "ready") return;
    if (!stored || stored.phase === "available" || stored.phase === "deferred" || stored.phase === "no-result" || stored.phase === "error") {
      persist(guideState("selected", { selectedChatIds: selectedIds }));
    }
  // The chooser is intentionally entered only when the modal opens, not on every selection change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSelecting, active, apiKeyConfigured, connection.status]);

  const beginSelection = () => persist(guideState("selected", { selectedChatIds: selectedIds }));
  const defer = () => {
    persist(guideState("deferred", { selectedChatIds: selectedIds }));
    onDeferred?.();
  };
  const retrySelection = () => {
    setProgress(undefined);
    persist(guideState("selected", { selectedChatIds: selectedIds }));
  };
  const checkAgain = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const toggle = (id: string) => {
    if (building) return;
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      persist(guideState("selected", { selectedChatIds: next }));
      return next;
    });
  };
  const build = async () => {
    if (buildInFlight.current || !selectedIds.length) return;
    const validIds = selectedIds.filter((id) => suggestedPeople.some((chat) => chat.id === id));
    if (!validIds.length) return;
    buildInFlight.current = true;
    setBuilding(true);
    setProgress({ completed: 0, total: validIds.length });
    persist(guideState("building", { selectedChatIds: validIds }));
    try {
      const result = await onBuild(validIds, firstRunSelectedPeopleTracking(), (completed, total) => setProgress({ completed, total }));
      const completedChatId = result.profiledChatIds[0];
      if (completedChatId) {
        persist(guideState("complete", { completedChatId, selectedChatIds: validIds }));
        onOpenProfile(completedChatId);
      } else {
        persist(guideState("no-result", {
          selectedChatIds: validIds,
          message: "That chat did not yet have enough usable messages for a first profile. Nothing else was scanned.",
        }));
      }
    } catch (error) {
      persist(guideState("error", {
        selectedChatIds: validIds,
        message: error instanceof Error ? error.message : "AmirOS could not prepare that person yet.",
      }));
    } finally {
      buildInFlight.current = false;
      setBuilding(false);
    }
  };

  if (phase === "hidden") return null;
  if (phase === "complete") return <section className="people-getting-started people-guide-complete" aria-label="People setup complete">
    <span className="people-guide-icon"><Check size={18} /></span><div><small>People is ready</small><h2>Your first person is ready to review.</h2><p>AmirOS created a profile only for the chat you chose.</p></div>
    <button className="button compact" type="button" onClick={() => stored?.completedChatId && onOpenProfile(stored.completedChatId)}>Open profile</button>
  </section>;

  if (phase === "waiting" || phase === "no-result" || phase === "error") {
    const noChatsYet = phase === "waiting";
    const isError = phase === "error";
    return <section className={`people-getting-started people-guide-notice ${isError ? "is-error" : ""}`} aria-live="polite">
      <span className="people-guide-icon">{isError ? <AlertTriangle size={18} /> : <Users size={18} />}</span>
      <div><small>Choose people to get started</small><h2>{noChatsYet ? "WhatsApp is connected. Your chats are still arriving." : isError ? "People setup needs another try." : "No eligible private chat is ready yet."}</h2><p>{stored?.message || (noChatsYet ? "AmirOS will show recent private chats here when WhatsApp finishes making them available. It has not scanned a conversation." : "Try checking again, or choose another private chat when one appears. Groups are not included here.")}</p></div>
      <div className="people-guide-actions"><button className="button compact" type="button" disabled={refreshing} onClick={() => void checkAgain()}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{refreshing ? "Checking…" : "Check again"}</button>{isError || phase === "no-result" ? <button className="button compact ghost" type="button" onClick={retrySelection}>Choose people</button> : null}<button className="text-action" type="button" onClick={onOpenHelp}><LifeBuoy size={14} /> Help</button></div>
    </section>;
  }

  const selecting = phase === "selected" || phase === "building";
  return <section className={`people-getting-started ${selecting ? "is-expanded" : ""}`} aria-labelledby="people-getting-started-title">
    <span className="people-guide-icon"><Brain size={19} /></span>
    <div className="people-guide-copy"><small>First useful step</small><h2 id="people-getting-started-title">Choose people to get started.</h2><p>Pick a person you know well. AmirOS will only read up to {FIRST_RUN_PEOPLE_SCAN_LIMIT} recent messages from chats you select to build an initial profile.</p></div>
    {!selecting ? <div className="people-guide-actions"><button className="button primary compact" type="button" onClick={beginSelection}>Choose people</button><button className="text-action" type="button" onClick={defer}>Not now <ChevronDown size={14} /></button></div> : null}
    {selecting ? <div className="people-guide-selection">
      <div className="people-guide-selection-header"><span>Recent private chats · favorites first · up to {FIRST_RUN_PEOPLE_SUGGESTION_LIMIT}</span><button type="button" disabled={building} onClick={() => {
        const next = selectedIds.length === suggestedPeople.length ? [] : suggestedPeople.map((chat) => chat.id);
        setSelectedIds(next); persist(guideState("selected", { selectedChatIds: next }));
      }}>{selectedIds.length === suggestedPeople.length ? "Clear" : "Select all"}</button></div>
      <div className="people-guide-list" role="group" aria-label="People to learn about">{suggestedPeople.map((chat) => <label key={chat.id} className={selectedIds.includes(chat.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.includes(chat.id)} disabled={building} onChange={() => toggle(chat.id)} /><img src={chat.avatarUrl} alt="" /><span><strong>{chat.name}</strong><small>{chat.pinned ? <><Heart size={12} fill="currentColor" /> Favorite</> : "Recent private conversation"}</small></span></label>)}</div>
      <p className="people-guide-boundary">Nothing is read from people you leave unselected. Groups are set up separately.</p>
      {selectedIds.length ? <p className="people-guide-disclosure">Build first profile uses up to {FIRST_RUN_PEOPLE_SCAN_LIMIT} recent messages from the chats you selected. Nothing else is scanned.</p> : null}
      {progress ? <div className="people-guide-progress" role="status"><LoaderCircle className={building ? "spin" : ""} size={16} /><span><strong>{building ? firstRunPeopleProgressLabel(progress.completed, progress.total) : "Finishing up"}</strong><small>AmirOS is working only with the chats you selected.</small></span></div> : null}
      <div className="people-guide-actions"><button className="button compact ghost" type="button" disabled={building} onClick={defer}>Not now</button><button className="text-action" type="button" disabled={building} onClick={onOpenHelp}><LifeBuoy size={14} /> Help</button><button className="button primary compact" type="button" disabled={building || !selectedIds.length} onClick={() => void build()}>{building ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{building ? "Building profile…" : "Build first profile"}</button></div>
    </div> : null}
  </section>;
}
