FROM debian:12-slim

# coturn + iproute2 (щоб визначити локальну IP) + сертифікати
RUN apt-get update && \
    apt-get install -y --no-install-recommends coturn iproute2 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Значення можна перекривати секретами/ENV у Fly (flyctl secrets set ...)
ENV REALM="koma" \
    TURN_USER="myuser" \
    TURN_PASS="very-strong-pass" \
    PUBLIC_IP4="0.0.0.0" \
    LISTEN_PORT="3478" \
    MIN_PORT="49160" \
    MAX_PORT="49180"

# Стартовий скрипт: визначає реальну локальну IP та запускає coturn
RUN printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  '' \
  ': "${REALM:=koma}"' \
  ': "${TURN_USER:=myuser}"' \
  ': "${TURN_PASS:=very-strong-pass}"' \
  ': "${PUBLIC_IP4:?Set PUBLIC_IP4 to your VM public IPv4}"' \
  ': "${LISTEN_PORT:=3478}"' \
  ': "${MIN_PORT:=49160}"' \
  ': "${MAX_PORT:=49180}"' \
  '' \
  '# Локальна IPv4, яку реально використовує VM назовні (у Fly часто 2 адреси на eth0)' \
  'LOCAL_IP=$(ip -4 route get 1.1.1.1 | awk "{print \$7; exit}")' \
  'if [[ -z "${LOCAL_IP:-}" ]]; then' \
  '  LOCAL_IP=$(ip -4 addr show dev eth0 | awk "/inet /{print \$2}" | cut -d/ -f1 | head -n1)' \
  'fi' \
  'echo "Using LOCAL_IP=${LOCAL_IP} and PUBLIC_IP4=${PUBLIC_IP4}"' \
  '' \
  'exec turnserver -n \' \
  '  --log-file=stdout --simple-log --fingerprint --lt-cred-mech \' \
  '  --realm "$REALM" --user "$TURN_USER:$TURN_PASS" \' \
  '  --listening-ip 0.0.0.0 --listening-port "$LISTEN_PORT" \' \
  '  --external-ip "${PUBLIC_IP4}/${LOCAL_IP}" \' \
  '  --min-port "$MIN_PORT" --max-port "$MAX_PORT" \' \
  '  --no-tls --no-dtls --no-multicast-peers --no-cli' \
  > /usr/local/bin/start-turn.sh && \
  chmod +x /usr/local/bin/start-turn.sh

# Документація портів у контейнері
EXPOSE 3478/udp 3478/tcp
EXPOSE 49160-49180/udp

CMD ["/usr/local/bin/start-turn.sh"]
