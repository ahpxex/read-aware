import { createContextBundle, type ContextBundleContent } from "./context-bundle";
import { identityProfileContext, type ProfileContextSnapshot } from "./identity-consolidation";
import { profileInspectionPage } from "./profile-inspection";

/** A profile recipe, not a dump of traits or an implicit memory search. */
export async function profileContextBundle(input: ProfileContextSnapshot) {
  const snapshot = structuredClone(input), profile = identityProfileContext(snapshot);
  const { revision } = await profileInspectionPage(snapshot);
  const content: ContextBundleContent = { format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
    kind: "user_profile_context", scope: { kind: "user" }, sourceRevision: revision, items: [], omissions: [] };
  if (profile.curated !== null) content.items.push({ kind: "curated_profile", id: "local", revision: snapshot.profile.revision,
    label: "Reader-curated profile (takes precedence)", text: profile.curated });
  if (profile.consolidated) content.items.push({ kind: "derived_profile", id: "local:consolidated", revision,
    label: "Automatically consolidated profile (inferred)", text: profile.consolidated.summary });
  else if (profile.derivedStatus !== "absent") content.omissions.push({ kind: "derived_profile", reason: "unavailable", count: 1 });
  return { bundle: await createContextBundle(content), derivedStatus: profile.derivedStatus };
}
