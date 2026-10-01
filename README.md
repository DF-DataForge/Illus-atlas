# Illus-atlas

Interactive verkooppunten map built with Express, Vite, React, and TypeScript.

## Local development

Use Node.js 24, then install dependencies and start the development server:

```sh
npm ci
npm run dev
```

Run the project checks and tests with `npm run check` and `npm test`. Create a
production build with `PUBLIC_SITE_URL=https://atlas.example.com npm run build`,
then start it with `npm start`. Replace `atlas.example.com` with the real
public HTTPS origin; this non-secret value is used at build time. If omitted,
social image URLs stay relative.

For an external Ubuntu server deployment, see the
[Hetzner deployment guide](deploy/hetzner/DEPLOY.md). It is a preparation guide;
the host deployment itself must be performed and verified by the operator.