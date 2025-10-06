FROM instrumentisto/coturn:latest

# Додаємо iproute2 для отримання локальної IP-адреси
RUN apk add --no-cache iproute2

# Значення за замовчуванням (їх можна перевизначити у fly.toml або через secrets)
ENV REALM=koma.local \
    TURN_USER=myuser \
    TURN_PASS=very-strong-pass \
    LISTEN_PORT=3478 \
    MIN_PORT=49160 \
    MAX_PORT=49180

# PUBLIC_IP4 задається у fly.toml (через [env])
# На старті контейнера дізнаємося приватну IP eth0 і запускаємо Coturn
CMD /bin/sh -lc '\
  PRIVATE_IP4=$(/sbin/ip -4 -o addr show dev eth0 | awk "{print \$4}" | cut -d/ -f1 | head -n1); \
  echo "Detected PRIVATE_IP4=${PRIVATE_IP4}"; \
  exec turnserver -n --log-file=stdout --simple-log \
    --realm ${REALM} \
    --lt-cred-mech --user ${TURN_USER}:${TURN_PASS} \
    --cli-password disabled-cli \
    --fingerprint \
    --listening-ip 0.0.0.0 \
    --external-ip ${PUBLIC_IP4}/${PRIVATE_IP4} \
    --listening-port ${LISTEN_PORT} \
    --no-tls --no-dtls \
    --min-port ${MIN_PORT} --max-port ${MAX_PORT} \
    --no-multicast-peers --no-loopback-peers \
'
