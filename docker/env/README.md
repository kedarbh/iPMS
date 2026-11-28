# Environment Files per Service

This directory contains individual environment files for each microservice and its dedicated database:

| Service / Database | Environment File | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **IAM Database** | `iam-db.env` | 5433 (mapped to 5432) | PostgreSQL credentials for IAM database (`ipms_iam`) |
| **IAM Service** | `iam.env` | 3001 | Identity and Access Management service + migrations |
| **Audit Database** | `audit-db.env` | 5434 (mapped to 5432) | PostgreSQL credentials for Audit database (`ipms_audit`) |
| **Audit Service** | `audit.env` | 3003 | Tamper-evident Audit logging service + migrations |
| **Project Database** | `project-db.env` | 5435 (mapped to 5432) | PostgreSQL credentials for Project database (`ipms_project`) |
| **Project Service** | `project.env` | 3004 | Projects, sites, and tasks management service + migrations |
| **QC Database** | `qc-db.env` | 5436 (mapped to 5432) | PostgreSQL credentials for Quality Control database (`ipms_qc`) |
| **QC Service** | `qc.env` | 3005 | Quality Control inspections and checklists service + migrations. Calls media at submit (MEDIA_INTERNAL_URL). |
| **Media Database** | `media-db.env` | 5437 (mapped to 5432) | PostgreSQL credentials for Media database (`ipms_media`) |
| **Media Service** | `media.env` | 3006 | Media (evidence uploads) service + migrations |
| **Notification Database** | `notification-db.env` | 5438 (mapped to 5432) | PostgreSQL credentials for Notification database (`ipms_notification`) |
| **Notification Service** | `notification.env` | 3007 | Notification service + migrations. Consumes qc submission and finance request events from NATS; calls iam (IAM_INTERNAL_URL) with INTERNAL_SERVICE_KEY. |
| **Docs Database** | `docs-db.env` | 5439 (mapped to 5432) | PostgreSQL credentials for Docs database (`ipms_docs`) |
| **Docs Service** | `docs.env` | 3008 | Documents service + migrations |
| **Finance Database** | `finance-db.env` | 5440 (mapped to 5432) | PostgreSQL credentials for Finance database (`ipms_finance`) |
| **Finance Service** | `finance.env` | 3009 | Advance, settlement and reimbursement requests with PM → Director → Finance approval + migrations. Calls project (PROJECT_INTERNAL_URL) with the caller's token for scope. |
| **API Gateway** | `gateway.env` | 3000 | Reverse proxy, authentication verification, rate limiter |
| **Web Frontend** | `web.env` | 3100 | Next.js portfolio dashboard web application |

## Media object storage

All of media's object-storage settings live in **`media.secrets.env`** next to
`media.env`. It is gitignored: never commit it. `media.env` deliberately has no
`S3_*` values, so if the file is missing media refuses to start (`S3_ENDPOINT is
not set`) rather than silently using some other storage. Create it from one of
two templates:

| Where | Copy this template | Storage |
|---|---|---|
| Production, staging, or local testing against R2 | `media.secrets.env.example` | Cloudflare R2 (`ipms-media-prod` in production, `ipms-media-staging` everywhere else) |
| Local, without R2 keys | `media.secrets.env.local-minio.example` | The opt-in MinIO container |

The R2 values look like this:

    S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_REGION=auto
    S3_BUCKET=ipms-media-prod            # or ipms-media-staging
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    S3_FORCE_PATH_STYLE=false
    S3_AUTO_CREATE_BUCKET=false

The web app uploads invoice photos from its own server: it PUTs the bytes to the
presigned link, so the web container must be able to reach `S3_PUBLIC_ENDPOINT`.
With the local MinIO template that is `http://localhost:9000`, which a container
cannot reach; set it to the machine's LAN IP (as phones need anyway).

All eight `S3_*` values are required. Media reads them once at startup and fails
immediately if any is missing, instead of failing on the first upload.

The MinIO container is off by default and never runs on a server. To use it
locally, copy the local-minio template, then start the stack with its profile:

    docker compose -f docker/docker-compose.yml --profile local-storage up -d

Automated tests don't depend on any of this: they start their own throwaway
MinIO container.

### Deployment checklist (per environment)

1. R2 bucket exists with `r2.dev` public access disabled and no custom domain.
2. An Account API token scoped to **that bucket only**, *Object Read & Write*, **no client IP filter**.
3. Lifecycle rule: abort incomplete multipart uploads after 7 days. No object-expiry rules.
4. `media.secrets.env` created on the server from `media.secrets.env.example`, with that environment's bucket and token (`chmod 600`). Do **not** pass `--profile local-storage` on a server.
5. When the environment has a web domain: CORS policy allowing `GET`, `PUT`, `HEAD` from that origin only, headers `content-type` and `x-amz-checksum-sha256`, exposing `ETag`.
6. Check the media startup log shows `storage configured` with the R2 host and the expected bucket.
7. Smoke test: register, upload and complete one photo against the bucket, confirm it turns `READY`, open its view link, then delete it. Also confirm the multipart (video) path against the same bucket: register an 11 MiB mp4, upload part 1, check `POST /media/uploads/status`, fetch fresh URLs for the remaining parts (`POST /media/uploads/:id/parts`), finish uploading, call `complete`, and confirm the object turns `READY`. This exercises R2's actual multipart behaviour and error names (`NoSuchUpload`, `InvalidPart`, …), which MinIO does not always reproduce exactly.

## Internal service key

`INTERNAL_SERVICE_KEY` authenticates service-to-service calls that carry no user token. Today that is
notification asking iam which users may review a project (`POST /api/v1/internal/authz/holders`).
The value must be identical in `iam.env` and `notification.env`. iam refuses to start in
`NODE_ENV=production` without it. To rotate: change both files and redeploy iam and notification
within seconds of each other. Events handled while the two differ are retried only briefly (about
30 s of backoff) and then dropped and logged: there is no dead-letter store yet, so those reviewer
notifications are lost.
