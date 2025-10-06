FROM instrumentisto/coturn:4.6

ENV REALM="koma.local" \
    TURN_USER="myuser" \
    TURN_PASS="very-strong-pass" \
    PUBLIC_IP4="66.241.124.113" \
    LISTEN_PORT="3478" \
    MIN_PORT="49160" \
    MAX_PORT="49180"

# Однорядковий exec-form, щоб лінтер не лаявся
CMD ["turnserver","-n","--log-file=stdout","--simple-log","--fingerprint","--lt-cred-mech","--realm","${REALM}","--user","${TURN_USER}:${TURN_PASS}","--listening-port","${LISTEN_PORT}","--listening-ip","0.0.0.0","--relay-ip","${PUBLIC_IP4}","--min-port","${MIN_PORT}","--max-port","${MAX_PORT}","--no-multicast-peers","--no-cli"]
