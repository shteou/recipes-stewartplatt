FROM klakegg/hugo:0.81.0-busybox as builder

COPY site /site

WORKDIR /site

ENV HUGO_ENV=production
RUN hugo



FROM nginx:1.19.8-alpine as serve

COPY --from=builder /site/public /usr/share/nginx/html
