FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 REMITTANCE_DB=/var/lib/remittance-review/desk.sqlite
RUN install -d -o node -g node /var/lib/remittance-review
COPY --from=build /app/dist ./dist
COPY server.mjs ./
COPY server/desk.mjs server/diana.mjs server/local.mjs server/records.mjs ./server/
USER node
EXPOSE 5173
VOLUME ["/var/lib/remittance-review"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"
CMD ["node", "server.mjs"]
