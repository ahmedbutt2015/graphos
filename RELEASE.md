# Releasing GraphOS

You — Ahmed — run these commands. I (Claude) won't publish on your behalf.

## One-time setup

```bash
# Log in to npm
npm login

# Confirm you have access to the @graphos scope (create org on npm if not)
npm org ls graphos
```

If `@graphos` is not yet your scope, create it at https://www.npmjs.com/org/create.

## Publish v1.0.0

Always publish in dependency order: `core` → `sdk` → `dashboard`.

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/AI/graphos

# 1. Publish core (sdk depends on it)
cd packages/core
pnpm publish --access public --no-git-checks

# 2. Publish sdk (dashboard depends on core; sdk depends on core)
cd ../sdk
pnpm publish --access public --no-git-checks

# 3. Publish dashboard
cd ../dashboard
pnpm publish --access public --no-git-checks
```

Why `pnpm publish` (not `npm publish`):
- pnpm rewrites `workspace:*` deps to the actual published version automatically.
- `npm publish` would publish `workspace:*` literally, which is broken.

`--no-git-checks` skips pnpm's "branch must be main / no uncommitted changes" check. Drop it if you'd rather pnpm enforce that.

## Verify the published packages

```bash
# In a scratch dir
mkdir /tmp/graphos-smoke && cd /tmp/graphos-smoke
npm init -y
npm install @graphos-io/sdk

# Should print "1.0.0"
node -e "console.log(require('@graphos-io/sdk/package.json').version)"

# Run the dashboard from a fresh install
npx @graphos-io/dashboard graphos dashboard
# open http://localhost:4000
```

## Tag the release

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/AI/graphos
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

Optionally create a GitHub release pointing at the tag with the v1.0.0 section of CHANGELOG.md as the body.

## Patch releases

Bump the version in the affected package(s), update CHANGELOG.md, and re-run the publish steps for those packages only. Don't bump unaffected packages.

## Unpublish (within 72h)

```bash
npm unpublish @graphos-io/dashboard@1.0.0
```

After 72 hours, npm refuses unpublish for the version (you can deprecate it instead with `npm deprecate @graphos-io/dashboard@1.0.0 "use 1.0.1 instead"`).
