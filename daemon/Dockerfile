# The node agent as a container.
#
# It runs the same source the checkout runs (tsx over src/, no build
# step to drift from it) and needs three things from the host:
#
#   /var/run/docker.sock   the engine it drives — root-equivalent, which is
#                          what an agent that creates containers is anyway
#   /var/lib/geeboard      the data root, mounted at the SAME path it has on
#                          the host: the agent writes a server's files there
#                          and asks the engine to bind that path into the
#                          game's container, so both must mean one directory
#   /etc/geeboard          agent.json, written by `join`
#
# See deploy/linux/ for the systemd unit and the install script.
FROM node:24-alpine

WORKDIR /opt/geeboard/daemon

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/geeboard-agent
RUN chmod +x /usr/local/bin/geeboard-agent

ENV GEEBOARD_AGENT_FILE=/etc/geeboard/agent.json \
    GEEBOARD_DATA_ROOT=/var/lib/geeboard/servers \
    NODE_ENV=production

EXPOSE 8080
ENTRYPOINT ["geeboard-agent"]
CMD ["start"]
