# docker build -t sigil-sandbox:node22 -f packages/sandbox/Dockerfile .   (context = repo root; tag = SANDBOX_IMAGE in trace.ts)
# The "second machine" of spec §13 step 4: scripts/verify-determinism.ts runs the same runner.ts + shim.cjs in here
# (other filesystem, user, hostname, --network none) and compares trace hashes with the host.
# runtime.node is inside the hashed canonical form, so this tag MUST be the exact Node in .nvmrc.
FROM node:22.13.0-slim
WORKDIR /app
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/sandbox/src packages/sandbox/src
COPY packages/sandbox/fixtures packages/sandbox/fixtures
RUN mkdir -p packages/sandbox/node_modules/@sigil && ln -s ../../../shared packages/sandbox/node_modules/@sigil/shared
USER node
# ponytail: no npm install — Node's own type stripping loads the .ts sources (erasable-only TS: no enums/namespaces/
# parameter properties). If someone adds one, `RUN npm i -g tsx@4.23.13` and make the entrypoint `tsx`.
# ponytail: no --platform pin; the image follows the daemon's arch (linux/arm64 on this Mac). The hash covers
# process.version, not arch, so an x86 judge matches too; add --platform=linux/amd64 only for byte-identical images.
ENTRYPOINT ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
