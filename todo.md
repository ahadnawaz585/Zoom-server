

# ⚙️ Deployment & Infrastructure Overview

This document outlines the infrastructure, load management, and orchestration strategy for our multi-client browser-based system, including Playwright automation, VPS orchestration, and network configurations.

---

## 📦 Clients & Methods

- **Minimal load clients**
- **Initial load optimization**
- **Browser tab handling for incoming requests**
- **UUID-based browser preloading & termination**
- **Cleanup routines for closed/terminated processes**

---

## 📑 Hertz & OS Process Management

- **Multiple instructions per cycle**
- OS-level process **priority management**
- Worker thread management for simultaneous executions
- Timeout handlers tied to processes and tasks

---

## 🎭 Playwright Automation

- **10 parallel Playwright instances**
- Automated browser orchestration
- Preloading browser indexes with UUID tagging
- Controlled termination and cleanup after task completion

---

## 🕰️ Timeouts & Process Management

- Defined **timeouts for all processes**
- Preloaded browser instances identified via **UUID**
- Dedicated **cleanup routines** on process exit

---

## 🖥️ Shell & Cron Jobs

- **Shell scripts** for process health checks, reboots, and cleanup
- **Crone jobs** for scheduled automation and log maintenance

---

## 🌐 VPS & Networking

- **Primary VPS internet speed**: 8-12 Mbps
- Target network throughput: **80 Mbps+**

---

## 🧵 Concurrency & Load Balancing

- **Simultaneous worker threads**: 3000+
- **PM2 instances**: 4 (across subdomains)
- **Max connections per process**: 100
- Load balancing logic:
  - **4 VPS deployments** (hit-and-trial based optimization)
  - Distributed across **4 different global regions**
  - **1 dedicated VPS** for sensitive processes

---

## 📄 Iframe Handling

- **10 individual iframe documents**
- Isolated sandboxed environments per iframe for security and performance

---

## 🖧 Local Network & ISP Configuration

- **LAN speed**: 100 Gbps across 3 VPS
- **4 different ISPs** for redundancy and regional failover

---

## 📊 Summary

| Component                    | Count / Spec           |
|:----------------------------|:----------------------|
| Playwright Instances         | 10                     |
| Concurrent Worker Threads    | 3000+                  |
| PM2 Processes                | 4                      |
| Subdomains                   | 4                      |
| Max Connections per Process  | 100                    |
| Iframes                      | 10                     |
| VPS Count                    | 4 (across 4 regions)   |
| Dedicated VPS                | 1                      |
| Internet Speed (VPS)         | 8-12 Mbps (target 80+) |
| LAN Speed (Local VPS)        | 100 Gbps               |
| ISPs                         | 4                      |

---

## 📌 Notes

- Load balancing and region optimization are based on hit-and-trial performance metrics.
- Dedicated routines for preloading, UUID indexing, process timeout, and cleanup.
- Process orchestration via PM2 and OS-level process priority management.
- Crone jobs for routine maintenance and process health monitoring.

---
