FROM node:16-alpine

WORKDIR /app
COPY ./package.json /app/
RUN yarn
COPY . /app/
RUN yarn build

ADD crontab /var/spool/crontab/root
RUN crontab /var/spool/crontab/root

ENTRYPOINT ["crond", "-f"]