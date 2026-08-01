# klakegg/hugo is archived/unmaintained (stuck around Hugo 0.83); hugomods/hugo
# is the actively maintained successor. Pinned version is validated against
# this site's theme (recipe-book) - see PLAN.md for the compatibility check.
FROM hugomods/hugo:0.111.3 as builder

COPY site /site

WORKDIR /site

ENV HUGO_ENV=production
RUN hugo



# Not used by deploy/deploy.py (which only builds --target=builder and ships
# the static /site/public output to Cloudflare Pages). Kept for local preview:
#   docker build -t recipes-stewartplatt-preview . && docker run --rm -p 8080:80 recipes-stewartplatt-preview
FROM nginx:1.19.8-alpine as serve

COPY --from=builder /site/public /usr/share/nginx/html
