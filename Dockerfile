FROM instrumentisto/coturn:latest

ENV REALM=koma.local \
    TURN_USER=test \
    TURN_PASS=test123 \
    LISTEN_PORT=3478 \
    MIN_PORT=49160 \
    MAX_PORT=49180

CMD turnserver \
  -n --log-file=stdout --simple-log \
  --realm ${REALM} \
  --lt-cred-mech --user ${TURN_USER}:${TURN_PASS} \
  --fingerprint \
  --listening-ip 0.0.0.0 \
  --relay-ip ${FLY_PUBLIC_IP} \
  --external-ip ${FLY_PUBLIC_IP} \
  --listening-port ${LISTEN_PORT} \
  --no-tls --no-dtls \
  --min-port ${MIN_PORT} --max-port ${MAX_PORT}
