import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { pickSkillsDir, readSkill, type SkillMeta } from "@/lib/skills";
import { useSkills } from "@/store/skills";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useT } from "@/store/i18n";

/**
 * Skills settings card. Skills are SKILL.md folders managed by the Rust `skills`
 * store (the Agent Skills standard). This card authors them (create/edit/delete),
 * toggles them, and imports existing folders (e.g. `~/.claude/skills`). Only the
 * enabled skills' name+description ride in the system prompt; the model loads a
 * body on demand via the built-in `skill__load_skill` tool.
 */

/** Draft for the inline create/edit form. `slug` set ⇒ editing an existing skill. */
type Draft = { slug?: string; name: string; description: string; body: string };

function SkillRow({
  p,
  onEdit,
}: {
  p: SkillMeta;
  onEdit: (p: SkillMeta) => void;
}) {
  const t = useT();
  const setEnabled = useSkills((s) => s.setEnabled);
  const remove = useSkills((s) => s.remove);

  return (
    <div className="flex items-start justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{p.name}</span>
        {p.description && (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            {p.description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant={p.enabled ? "default" : "outline"}
          onClick={() => void setEnabled(p.name, !p.enabled)}
        >
          {p.enabled ? t("common.enabled") : t("common.disabled")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(p)}>
          {t("common.edit")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void confirmDialog({
              title: tNow("skills.deleteTitle", { name: p.name }),
              confirmText: tNow("common.delete"),
              destructive: true,
            }).then((ok) => {
              if (ok) void remove(p.name);
            });
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}

function SkillEditor({
  draft,
  onClose,
}: {
  draft: Draft;
  onClose: () => void;
}) {
  const t = useT();
  const save = useSkills((s) => s.save);
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await save(name.trim(), description.trim(), body, draft.slug);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skill-name">{t("skills.nameLabel")}</Label>
        <Input
          id="skill-name"
          value={name}
          placeholder={t("skills.namePlaceholder")}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skill-desc">{t("skills.descriptionLabel")}</Label>
        <Input
          id="skill-desc"
          value={description}
          placeholder={t("skills.descriptionPlaceholder")}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skill-body">{t("skills.instructionsLabel")}</Label>
        <Textarea
          id="skill-body"
          value={body}
          placeholder={t("skills.instructionsPlaceholder")}
          disabled={busy}
          rows={8}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex items-center gap-2">
        <Button
          onClick={() => void onSave()}
          disabled={busy || name.trim().length === 0}
        >
          {busy ? t("skills.saving") : t("common.save")}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function Skills() {
  const t = useT();
  const skills = useSkills((s) => s.skills);
  const loaded = useSkills((s) => s.loaded);
  const error = useSkills((s) => s.error);
  const list = useSkills((s) => s.list);
  const importFrom = useSkills((s) => s.importFrom);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void list();
  }, [list]);

  async function startEdit(p: SkillMeta) {
    const body = await readSkill(p.name).catch(() => "");
    setNotice(null);
    setDraft({ slug: p.slug, name: p.name, description: p.description, body });
  }

  async function onImport() {
    setNotice(null);
    const dir = await pickSkillsDir().catch(() => null);
    if (!dir) return;
    const n = await importFrom(dir);
    setNotice(tNow("skills.imported", { count: String(n) }));
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("skills.title")}</CardTitle>
        <CardDescription>{t("skills.description")}</CardDescription>
        <div className="flex items-center gap-2 pt-2">
          <Button
            size="sm"
            onClick={() => {
              setNotice(null);
              setDraft({ name: "", description: "", body: "" });
            }}
          >
            {t("skills.new")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onImport()}>
            {t("skills.import")}
          </Button>
        </div>
        <p className="text-muted-foreground pt-1 text-xs">
          {t("skills.importHint")}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col">
        {draft && (
          <SkillEditor
            key={draft.slug ?? "new"}
            draft={draft}
            onClose={() => setDraft(null)}
          />
        )}
        {notice && <p className="text-muted-foreground mb-2 text-sm">{notice}</p>}
        {!loaded && (
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        )}
        {loaded && skills.length === 0 && !draft && (
          <p className="text-muted-foreground text-sm">{t("skills.none")}</p>
        )}
        {loaded &&
          skills.map((p) => (
            <SkillRow key={p.slug} p={p} onEdit={(s) => void startEdit(s)} />
          ))}
        {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
