import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store";
import { api, errorMessage, type DirectorStatus } from "@/lib/api";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { SectionTitle } from "@/ui/surface";
import { Card, Confirm, Dot, Row } from "./common";

export function DirectorCard() {
  const refreshKey = useStore((s) => s.refreshKey);
  const [s, setS] = useState<DirectorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setS(await api.directorStatus());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const saveKey = async () => {
    const v = value;
    setValue("");
    try {
      await api.anthropicKeySet(v);
      toast.success("Anthropic key saved to keychain");
      setAdding(false);
      await Promise.all([load(), refreshKey()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const cli = !s
    ? "Checking…"
    : !s.cli_installed
      ? "Not installed"
      : s.cli_logged_in
        ? "Installed · logged in"
        : "Installed · not logged in";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Claude director</SectionTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh director status"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      <Row label="Claude Code CLI">
        <span className={s?.cli_logged_in ? "font-semibold text-accent" : "text-text-2"}>
          <Dot ok={!!s?.cli_logged_in} warn={!!s?.cli_installed && !s.cli_logged_in} /> {cli}
        </span>
      </Row>
      {s?.cli_installed && (
        <Row label="Version" muted>
          <span className="truncate font-mono text-xs">
            {s.cli_version ?? "?"}
            {s.cli_auth_method ? ` · ${s.cli_auth_method}` : ""}
          </span>
        </Row>
      )}
      {s && !s.cli_installed && (
        <div className="text-xs text-text-3">
          Install Claude Code, then run <code className="font-mono text-text-2">claude</code> once in a
          terminal to log in. The director uses your subscription, so briefs don't cost API credits.
        </div>
      )}
      <Row label="Anthropic API key (fallback)" muted>
        {s?.api_key_present ? (
          <>
            <span className="text-text-1">
              <Dot ok /> Saved
            </span>
            <Confirm
              title="Remove the Anthropic key?"
              description="The director falls back to it only when Claude Code isn't available."
              action="Remove"
              onConfirm={async () => {
                await api.anthropicKeyDelete();
                await Promise.all([load(), refreshKey()]);
              }}
            >
              <Button size="sm" variant="ghost">
                Remove
              </Button>
            </Confirm>
          </>
        ) : (
          <>
            <span>Not set</span>
            <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
              {adding ? "Cancel" : "Add"}
            </Button>
          </>
        )}
      </Row>
      {adding && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveKey();
          }}
        >
          <label htmlFor="anthropic-key" className="sr-only">
            Anthropic API key
          </label>
          <Input
            id="anthropic-key"
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="sk-ant-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" variant="inverse" disabled={!value.trim()}>
            Save
          </Button>
        </form>
      )}
      <Row label="System prompt" muted>
        <span className="truncate font-mono text-xs" title={s?.prompt_path}>
          {s?.prompt_path.split(/[\\/]/).slice(-2).join("/") ?? "director.md"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => api.directorPromptOpen().catch((e) => toast.error(errorMessage(e)))}
        >
          Edit
        </Button>
        <Confirm
          title="Reset the director prompt?"
          description="Your edits to director.md are replaced with the bundled default."
          action="Reset"
          onConfirm={async () => {
            await api.directorPromptReset();
            toast.success("Prompt reset");
          }}
        >
          <Button size="sm" variant="ghost">
            Reset
          </Button>
        </Confirm>
      </Row>
    </Card>
  );
}
