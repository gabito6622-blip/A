#!/bin/bash
# Vuelve la base de demo al estado base (datos ficticios) antes de grabar un tutorial.
D=/tmp/claude-0/-workspace-A/54aab0e5-b810-5a8a-a381-3dd90d647a94/scratchpad/tut
cd /tmp && pg_restore -h localhost -U gabo_owner -d gabo --clean --if-exists --single-transaction $D/base.dump 2>&1 | grep -v "^$" | head -3
