# Releasing GraphOS

Maintainer guide for cutting a new release. Public users don't need this — see the root [README](./README.md) instead.

## Prerequisites

- npm account in the `graphos-io` org (https://www.npmjs.com/org/graphos-io)
- Either a granular access token with "bypass 2FA on publish" enabled, or a TOTP authenticator if your account uses code-based 2FA

## Workflow

1. Decide which package(s) need a bump. Don't version unchanged packages.
2. Bump versions in the affected `package.json` files.
3. Update `CHANGELOG.md` with the changes under a new heading.
4. Run the full check:
   ```bash
   pnpm -r build
   pnpm -r test
   ```
5. Pack each affected package (pnpm rewrites `workspace:*` to the resolved version):
   ```bash
   rm -rf /tmp/graphos-publish && mkdir -p /tmp/graphos-publish
   cd packages/core      && pnpm pack --pack-destination /tmp/graphos-publish
   cd ../sdk             && pnpm pack --pack-destination /tmp/graphos-publish
   cd ../dashboard       && rm -rf .next/cache && pnpm pack --pack-destination /tmp/graphos-publish
   ```
6. Publish in dependency order — `core` → `sdk` → `dashboard`:
   ```bash
   npm publish /tmp/graphos-publish/graphos-io-core-X.Y.Z.tgz       --access public
   npm publish /tmp/graphos-publish/graphos-io-sdk-X.Y.Z.tgz        --access public
   npm publish /tmp/graphos-publish/graphos-io-dashboard-X.Y.Z.tgz  --access public
   ```
7. Verify:
   ```bash
   npm view @graphos-io/core version
   npm view @graphos-io/sdk version
   npm view @graphos-io/dashboard version
   ```
8. Commit, tag, push:
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
9. Optionally create a GitHub Release pointing at the tag, body = the CHANGELOG entry.

## Why `pnpm pack` then `npm publish`

`pnpm pack` rewrites `workspace:*` dependencies to the actual published version inside the tarball. A direct `npm publish` from the source tree would publish `workspace:*` literally, which breaks installation outside the monorepo. `pnpm publish` would also rewrite, but doesn't accept `--auth-type=web` for browser-based 2FA, so we pack with pnpm and publish with npm.

## Unpublishing

Within 72 hours of publish:

```bash
npm unpublish @graphos-io/<package>@X.Y.Z
```

After 72 hours, npm rejects unpublish. Use deprecate instead:

```bash
npm deprecate @graphos-io/<package>@X.Y.Z "use vX.Y.Z+1 instead"
```

A version, once published, can never be republished — even after unpublish. Always bump the patch version when fixing a release.
