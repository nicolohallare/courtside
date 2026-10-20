#!/bin/bash
# keep indexing whatever lands in the uploads folder
U=/mnt/user-data/uploads/mdp3pics
while true; do
  for d in "$U"/*/"Day 1 Final" "$U"/*/"Day 2 Final"; do
    [ -d "$d" ] || continue
    ls "$d"/*.jpg >/dev/null 2>&1 || continue
    day=$(basename "$d" | sed 's/ Final//')
    node /root/mdp-index/index.js "$d" /root/mdp-out/all "$day" >> /root/mdp-out/log.txt 2>&1
  done
  sleep 5
done
