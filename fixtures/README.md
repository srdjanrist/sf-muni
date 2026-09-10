# Development fixtures

`gtfs.zip` is the unmodified SFMTA static GTFS archive from https://data.sfgov.org/download/dni7-qpv3/application/zip, downloaded 2026-09-08. The source filename is `SFMTA_GTFS_20260829_20270115v2.zip`. Source and transit data license: https://data.sfgov.org/d/dni7-qpv3.

Vehicle positions, trip updates, and alerts in fixture mode are **synthetic**, generated deterministically on this actual network at a playback clock beginning September 8, 2026, 14:00 America/Los_Angeles. They are encoded to GTFS-Realtime protobuf and decoded through the same production parser. The three `.pb` files are the initial example frames. No fixture measurement represents current transit service.

Fixture IDs begin `SIM-`. The app shows a persistent PLAYBACK label and a separate simulation clock. `transit:record-fixture` writes actual historical observations to `recorded/`, with provenance and matching static data. It never writes the API key.
