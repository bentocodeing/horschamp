import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { SectionTitle } from "@/ui/surface";
import { Card, Confirm } from "./common";

const keychainName = navigator.userAgent.includes("Mac") ? "macOS Keychain" : "your system keyring";

export function KeyCard() {
  const key = useStore((s) => s.key);
  const refreshKey = useStore((s) => s.refreshKey);
  const [editing, setEditing] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  // Pasting a full "KEY_ID:KEY_SECRET" into the ID field fills both fields.
  const onKeyIdChange = (v: string) => {
    const i = v.indexOf(":");
    if (i === -1) return setKeyId(v);
    setKeyId(v.slice(0, i).trim());
    setSecret(v.slice(i + 1).trim());
  };

  const canSave = keyId.trim() !== "" && secret.trim() !== "";

  const save = async () => {
    const v = `${keyId.trim()}:${secret.trim()}`;
    setSecret(""); // don't keep the secret in UI state
    if (!canSave) return;
    setBusy(true);
    try {
      const r = await api.keySet(v);
      if (r.ok) {
        toast.success(r.message);
        setEditing(false);
        setKeyId("");
        await refreshKey();
      } else {
        toast.error(`${r.message} The key was not saved.`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.keyTest();
      (r.ok ? toast.success : toast.error)(r.message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const showInput = !key?.present || editing;

  return (
    <Card>
      <SectionTitle className="flex items-center gap-2">
        <KeyRound className="size-4 text-text-2" /> Higgsfield API key
      </SectionTitle>
      <div className="text-xs text-text-2">Stored in {keychainName}. Never shown to the interface.</div>
      {key?.present && (
        <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-fill-1 px-3">
          <span className="font-mono text-text-2">{key.hint}</span>
          <span className="ml-auto text-xs font-semibold text-accent">● Connected</span>
        </div>
      )}
      {showInput && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="hf-key-id" className="text-xs text-text-2">
                Key ID
              </label>
              <Input
                id="hf-key-id"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="KEY_ID"
                value={keyId}
                onChange={(e) => onKeyIdChange(e.target.value)}
                className="h-10 font-mono"
                autoFocus={editing}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="hf-key-secret" className="text-xs text-text-2">
                Key secret
              </label>
              <Input
                id="hf-key-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="KEY_SECRET"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="h-10 font-mono"
              />
            </div>
          </div>
          <Button type="submit" variant="inverse" size="lg" className="self-end" disabled={busy || !canSave}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </form>
      )}
      {key?.present ? (
        <div className="flex gap-2">
          <Button onClick={test} disabled={busy}>
            Test
          </Button>
          <Button onClick={() => setEditing((e) => !e)}>{editing ? "Cancel" : "Replace"}</Button>
          <Confirm
            title="Delete the API key?"
            description="It's removed from your keychain. Running jobs stop updating until you add a key again."
            action="Delete key"
            onConfirm={async () => {
              await api.keyDelete();
              await refreshKey();
              toast.success("Key deleted");
            }}
          >
            <Button variant="destructive">Delete</Button>
          </Confirm>
        </div>
      ) : (
        <div className="text-xs text-text-3">
          Create a key in the Higgsfield console under API keys. Testing it doesn't spend credits.
        </div>
      )}
    </Card>
  );
}
