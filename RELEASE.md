# Release Process

## Making a Release

**1. Ensure the working tree is clean and tests pass.**

```sh
git status
npm test
```

**2. Bump the version.**

Choose the bump type based on what changed since the last release:

| What changed | Command |
|---|---|
| Bug fixes only | `npm version patch` |
| New features, backwards-compatible | `npm version minor` |
| Breaking changes | `npm version major` |

`npm version` will:
- Update the version in `package.json`
- Regenerate `src/buildInfo.ts` with the new version
- Create a git commit and tag (e.g. `v1.2.0`)

**3. Push the commit and tag.**

```sh
git push --follow-tags
```

This triggers a GitHub Actions workflow that creates a **draft** GitHub Release.

**4. Write the release notes.**

Go to the repository on GitHub → Releases → find the draft → click Edit.

Write user-facing release notes describing what changed, then click **Publish release**.

Publishing triggers a second workflow that builds the project and publishes the package to npm.

---
