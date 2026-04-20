# Landing Page for GitHub Pages

## Summary

This PR turns the old local landing page draft into a publish-ready static site for GitHub Pages.

## What changed

- replaced the raw single-file draft with a structured static site under `site/`
- aligned messaging with the actual shipped `v3.3.0` product state
- removed outdated `v3.1.0` references and fake install CTA copy
- made the landing Codex-first while keeping Claude Code support visible
- added a GitHub Pages workflow that publishes the `site/` directory
- removed runtime dependence on the Tailwind CDN by switching to a local Tailwind CSS build
- added a targeted landing-page contract test

## Validation

- `npm test -- packages/codex/tests/landing-page.test.ts`
- `npm run build:site`
- `npm run lint`
  - only the pre-existing `dist/server.js` max-size info remains
- manual local browser check of:
  - hero and CTA rendering
  - GitHub / release links
  - copy-to-clipboard button
  - clean browser console

## Notes

- this PR only prepares and publishes the landing from the existing repository as a GitHub Pages project site
- it does not create a separate marketing repository
- the landing intentionally stays honest about current `v3.3.0` shipped behavior vs. future roadmap items
