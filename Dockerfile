# DESIGN.md §8 Option A: the deploy contract only requires the `builder`
# stage to produce static output at /site/public — it doesn't know or care
# that this used to be Hugo. Pinned to the Node version this repo is
# developed against (see `node --version` locally), matching the
# comment-documented pinning convention the old Hugo builder used.
FROM node:22.23.2-alpine AS builder

WORKDIR /site

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build



# Not used by deploy/deploy.py (which only builds --target=builder and ships
# the static /site/public output to Cloudflare Pages). Kept for local preview:
#   docker build -t recipes-stewartplatt-preview . && docker run --rm -p 8080:80 recipes-stewartplatt-preview
FROM nginx:1.19.8-alpine as serve

COPY --from=builder /site/public /usr/share/nginx/html
