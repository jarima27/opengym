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
                                                                       → Play closed testing (optional)
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
5. **Google Play, automatically (optional).** See [Uploading to Google Play](#uploading-to-google-play)
   below; until it is set up, the `.aab` goes up by hand from the mirror's release page.
6. **The server pulls the images.** The hosted instance's compose file (`deploy/compose.yml`,
   set up as in [DEPLOY.md](DEPLOY.md)) runs `ghcr.io/jarima27/tiza-api` and
   `ghcr.io/jarima27/tiza-web` at the version in its `.env` (make the two packages public in
   GitHub → Packages, or log the server in to GHCR).

## Cutting a release

1. In the private repository, set the version in `frontend/package.json` (the tag must match it).
2. Commit, then tag and push: `git tag v1.4.0 && git push origin v1.4.0`.
3. `publish-mirror.yml` copies the tagged tree onto the mirror as "Tiza v1.4.0" and tags it;
   `release.yml` on the mirror tests it and builds everything.
4. With `TIZA_ANDROID_UPLOAD` on, the Android build is already on Play's closed testing track,
   and with `TIZA_IOS` on the iPhone build is in TestFlight; otherwise take the `.aab` from the
   mirror's release page to Play Console. Update the server to the new version (DEPLOY.md →
   *Day to day*).

A tag that is already on the mirror is refused, so a published version is never overwritten.
Google Play's version code comes from the version (1.4.0 → 10400), so it only goes up.

## Uploading to Google Play

With the variable `TIZA_ANDROID_UPLOAD` = `true` on the mirror, every release's signed bundle goes
to Google Play's **closed testing** track as one release named "1.4.0 (10400)", which the testers
get once Google has reviewed it (`scripts/play-upload.mjs`: the Play Developer API, signed in as
a service account; any failure leaves nothing half-made in Play Console). It is how the 14 days
of testing that Play asks of a new developer account work: each fix is a new patch version
(1.0.1, 1.0.2…), tagged like any release, and reaches the testers without opening Play Console.

**Once, in Google Play Console** (the app has to exist before the API can upload to it):

1. *Create app* (`Tiza`, app, free), and fill in what *Dashboard → Set up your app* asks for.
2. *Testing → Closed testing*: use the default track (*Closed testing*, which the API calls
   `alpha`) or create one; add the testers (an e-mail list or a Google Group) and the countries.
3. Upload the **first bundle by hand** to that track: the `.aab` from the mirror's release page,
   signed with the upload keystore of `release.yml`. Accept *Play App Signing*: Google keeps the
   app's signing key, your keystore only proves uploads are yours.

**Once, the service account:**

1. In [Google Cloud Console](https://console.cloud.google.com), a project (e.g. `tiza-release`):
   *APIs & Services → Enable APIs* → **Google Play Android Developer API**.
2. *IAM & Admin → Service accounts → Create*, name `tiza-release`, no roles. Then *Keys → Add
   key → JSON*: a file downloads. It is a password; it goes only into the secret below.
3. In Play Console, *Users and permissions → Invite new users*: the service account's e-mail
   (`tiza-release@<project>.iam.gserviceaccount.com`), *App permissions → Tiza* with **Release
   apps to testing tracks** (and *View app information*). Nothing at account level.

**Then, on the mirror** (*Settings → Secrets and variables → Actions*):

| | Name | Value |
|---|---|---|
| Secret | `PLAY_SERVICE_ACCOUNT_JSON` | the whole JSON key file |
| Variable | `TIZA_ANDROID_UPLOAD` | `true` |
| Variable | `PLAY_TRACK` | optional; `alpha` unless set (Play's own closed testing track) — a closed track you created goes by its name |
| Variable | `PLAY_RELEASE_STATUS` | optional; `completed` unless set. `draft` while Play still holds the app itself as a draft (it says so: *Only releases with status draft may be created on draft app*); then roll each release out from Play Console |

The upload needs the bundle signed (`ANDROID_UPLOAD_KEYSTORE_B64` and its passwords), and fails
the job — after the bundle is saved on the release page — when Play refuses it, with Play's
reason and what to do: a version code already used (bump the version), no rights for the
service account, an app that does not exist yet.

When the testing is over and production is open, the same releases can go to production by
promoting them in Play Console, or by setting `PLAY_TRACK` = `production`.

