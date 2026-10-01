# Releasing Tiza

Tiza is developed in a **private** repository. Every version that reaches the hosted service or
the app stores is published, as code, in a **public mirror**, and built there by GitHub Actions —
so what people run is exactly the source anyone can read, which is what the AGPL asks of a
modified openGym run as a network service and distributed as an app.

```
private working repo                     public mirror (jarima27/opengym, a fork of openGym)
───────────────────                      ──────────────────────────────────────────────────
branches, day-to-day commits             main: one commit per released version
tag vX.Y.Z ──publish-mirror.yml──▶       tag vX.Y.Z ──release.yml──▶ tests
                                                                     ghcr.io/<owner>/tiza-api, tiza-web
                                                                     Android app bundle (.aab)
                                                                     iPhone build → TestFlight (optional)
                                                                     GitHub release with the .aab
```

The mirror is the existing public fork: GitHub does not allow a fork of a public repository to
be made private, and keeping it public keeps the "forked from DuarteSantos8/openGym" credit and
every link that already points at it (the app's *source code* link, `NOTICE.md`, the website's
footer) working.

## One-time setup

1. **Make the private working repository.** On GitHub: *New repository → Import a repository*,
   source `https://github.com/jarima27/opengym`, visibility **Private** (for example
   `jarima27/tiza`). It copies every branch. Work there from now on.
2. **Clear the mirror of work in progress.** On the public fork, delete every branch except
   `main` (the day-to-day branches now live in the private repository). Its `main` receives one
   commit per release from now on.
3. **Token for publishing.** A fine-grained personal access token limited to the mirror with
   *Contents: read and write* and *Workflows: read and write*. In the private repository:
   secret `MIRROR_TOKEN`, variable `MIRROR_REPO` = `jarima27/opengym`.
4. **Builds on the mirror.** In the mirror: *Settings → Actions → Allow all actions*, variable
   `TIZA_RELEASES` = `true`, and the secrets of the parts you want built
   (`.github/workflows/release.yml` lists them): the Android upload keystore, and — with
   `TIZA_IOS` = `true` — the Apple team id and an App Store Connect API key.
5. **The server pulls the images.** Point the hosted instance's compose file at
   `ghcr.io/jarima27/tiza-api` and `ghcr.io/jarima27/tiza-web` (make the two packages public in
   GitHub → Packages, or log the server in to GHCR).

## Cutting a release

1. In the private repository, set the version in `frontend/package.json` (the tag must match it).
2. Commit, then tag and push: `git tag v1.4.0 && git push origin v1.4.0`.
3. `publish-mirror.yml` copies the tagged tree onto the mirror as "Tiza v1.4.0" and tags it;
   `release.yml` on the mirror tests it and builds everything.
4. Take the `.aab` from the mirror's release page to Google Play; the iPhone build is already in
   TestFlight when `TIZA_IOS` is on. Update the server to the new image tag.

A tag that is already on the mirror is refused, so a published version is never overwritten.
Google Play's version code comes from the version (1.4.0 → 10400), so it only goes up.
