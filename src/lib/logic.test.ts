import { describe, expect, it } from "vite-plus/test";
import registry from "../../models.json";
import type { Model, Shot } from "./api";
import {
  carryParams,
  defaultParams,
  groupOf,
  targetInputFor,
  tierSiblings,
  validateParams,
  fileKind,
} from "./params";
import { retryRequest, shotToRequest } from "./shots";
import { usd } from "./format";

const models = (registry as { models: Model[] }).models;
const get = (id: string) => models.find((m) => m.id === id)!;
const kling = get("kling-video/v3.0/pro/image-to-video");

describe("params", () => {
  it("builds defaults without media or prompt", () => {
    const d = defaultParams(kling);
    expect(d.duration).toBe(5);
    expect(d.sound).toBe("on");
    expect("image_url" in d).toBe(false);
    expect("prompt" in d).toBe(false);
  });

  it("groups inputs for the prompt bar", () => {
    const g = Object.fromEntries(kling.inputs.map((i) => [i.name, groupOf(i)]));
    expect(g.prompt).toBe("prompt");
    expect(g.image_url).toBe("media");
    expect(g.duration).toBe("primary");
    expect(g.cfg_scale).toBe("more");
    const seedance = get("bytedance/seedance-2.5/text-to-video");
    expect(groupOf(seedance.inputs.find((i) => i.name === "generate_audio")!)).toBe("primary");
  });

  it("finds quality tiers among sibling models", () => {
    const tiers = tierSiblings(get("kling-video/v3.0/std/text-to-video"), models);
    expect(tiers.map((t) => t.tier)).toEqual(["std", "pro", "4k"]);
    expect(tierSiblings(get("bytedance/seedance-2.5/text-to-video"), models)).toEqual([]);
  });

  it("validates like the backend", () => {
    const errs = validateParams(kling, { duration: 99, sound: "loud" }, new Set());
    expect(Object.keys(errs).sort()).toEqual(["duration", "image_url", "sound"]);
    expect(validateParams(kling, { duration: 5 }, new Set(["image_url"]))).toEqual({});
  });

  it("carries compatible params across models", () => {
    const t2v = get("kling-video/v3.0/pro/text-to-video");
    const out = carryParams({ duration: 10, sound: "off", nonsense: 1 }, t2v);
    expect(out.duration).toBe(10);
    expect("nonsense" in out).toBe(false);
  });

  it("routes dropped files to the right input", () => {
    expect(targetInputFor(kling, "image", new Set())?.name).toBe("image_url");
    expect(targetInputFor(kling, "image", new Set(["image_url"]))?.name).toBe("last_image_url");
    expect(fileKind("/a/B.PNG")).toBe("image");
    expect(fileKind("/a/b.mp4")).toBe("video");
    expect(fileKind("/a/b.txt")).toBeNull();
  });
});

describe("shots", () => {
  const shot: Shot = {
    title: "Pack reveal",
    model_id: kling.id,
    params: { prompt: "push in", image_url: "@pack.png", duration: 5 },
    why: "",
    needs: ["pack.png"],
    issues: [],
  };

  it("maps placeholders to attachments", () => {
    const { req, missing } = shotToRequest(shot, kling, ["/Users/me/refs/Pack.PNG"], {
      projectId: "p",
      briefId: "b",
      index: 2,
    });
    expect(missing).toEqual([]);
    expect(req.attachments).toEqual([{ path: "/Users/me/refs/Pack.PNG", param: "image_url" }]);
    expect(req.params).toEqual({ prompt: "push in", duration: 5 });
    expect(req.source).toBe("brief");
    expect(req.shot_index).toBe(2);
  });

  it("reports missing files", () => {
    const { missing } = shotToRequest(shot, kling, [], { projectId: null, briefId: "b", index: 0 });
    expect(missing).toEqual(["pack.png"]);
  });

  it("handles array placeholders", () => {
    const m = models.find((x) => x.inputs.some((i) => i.name === "image_urls"))!;
    const s: Shot = { ...shot, model_id: m.id, params: { prompt: "x", image_urls: ["@a.png", "@b.png"] } };
    const { req } = shotToRequest(s, m, ["/x/a.png", "/x/b.png"], {
      projectId: null,
      briefId: "b",
      index: 0,
    });
    expect(req.attachments.map((a) => a.param)).toEqual(["image_urls", "image_urls"]);
    expect("image_urls" in req.params).toBe(false);
  });

  it("builds retry requests without stale upload URLs", () => {
    const r = retryRequest({
      id: "j1",
      model_id: "m",
      params: { prompt: "p" },
      attachments: [{ path: "/a.png", param: "image_url", public_url: "https://old" }],
      project_id: null,
    });
    expect(r.attachments[0]).toEqual({ path: "/a.png", param: "image_url" });
    expect(r.retry_of).toBe("j1");
  });
});

describe("format", () => {
  it("formats usd", () => {
    expect(usd(0.094)).toBe("$0.094");
    expect(usd(0.12)).toBe("$0.12");
    expect(usd(0)).toBe("$0.00");
    expect(usd(12.5)).toBe("$12.50");
    expect(usd(null)).toBe("—");
  });
});
