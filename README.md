# SEAL – Software Engineering Hackathon Management System

SEAL (Software Engineering Agile League) is an academic hackathon organized annually by the Software Engineering Department in cooperation with PDP. Each year SEAL runs three seasons — Spring, Summer, and Fall — each of which may include multiple competition rounds (preliminary, qualifier, final).

This repository contains a full-stack web platform that digitizes and centralizes the operation of SEAL Hackathon events: event and round management, track/category management, team registration, submissions, judge scoring, ranking, prize announcement, and audit logging. The platform also supports an optional research-based-learning (RBL) track for studying inter-rater reliability among hackathon judges.

## Project Information

| Field | Details |
|-------|---------|
| University | FPT University Ho Chi Minh Campus |
| Course | SWP391 - Software Development Project |
| Semester / Term | Summer 2026 |
| Duration | May 14, 2026 - July 14, 2026 |
| Methodology | Agile Scrum |
| Number of Sprints | 3 |
| Team Size | 4 members |
| Supervisor / Mentor | Dr. Nguyen Thi Cam Huong (HuongNTC2) |

## Contributors

### Nhat Nguyen — Full-stack Developer / Team Lead

- Designed and implemented the system's authentication and authorization architecture: JWT-based session management (access/refresh token issuance, expiry, and secure cookie handling), OAuth2 single sign-on with Google and GitHub, and CSRF protection for state-changing requests.
- Directed the layered backend refactor (entity, repository, service, and controller layers) to align the codebase with the finalized database schema, improving maintainability and consistency across the Spring Boot application.
- Designed and iterated on the relational database schema (MySQL, JPA/Hibernate), including schema consolidation, migration scripts, and the demo/seed data scenarios used for grading and presentation.
- Implemented the Event Coordinator dashboard end-to-end, integrating judge assignment, score aggregation, and account-management workflows across frontend and backend.
- Led the UI design-system migration to a custom "Pixel" component library, removing over 40 legacy shadcn/ui components and superseded pages to reduce technical debt.
- Owned the team's Git workflow — branching strategy, pull request review, merge conflict resolution, and release coordination — across the project's development history.
- Served as technical lead: made architectural decisions and coordinated integration across the frontend, backend, and database work streams.

### Nguyen Huynh Khanh Trang — Frontend Developer & UI/UX

- Led UI/UX design in Figma and translated it into a shared, reusable component library (layout, overlay, navigation, data-display, and interaction components) used consistently across the application.
- Designed and implemented the shared dark cyber-tech design system used across the application.
- Built the scoring and ranking engine: Top-N advancement per track and overall, tie-break resolution by submission time, and anonymized team names in judge-facing views to reduce scoring bias.
- Implemented the final results experience — awards, history pages, and mentor/judge guide popups to support scoring and adjudication workflows.
- Built participant-facing flows: join-request handling for teams without an assigned track, the competition rules popup (with login auto-show and footer access), and event-status gating for participant team actions.
- Authored unit tests for the AI Judge Assistant's repository parsing and analysis-mapping logic.
- Contributed to backend service/entity/DTO alignment when the database schema was restructured (admin-split schema, `judgeType` field).

### Khanh Nguyen Le Huu — Frontend Developer

- Bootstrapped the frontend codebase, initializing the Vite + React + TypeScript project that the rest of the team built on.
- Built and maintained core dashboard flows across events, tracks, teams, and notifications, including audit-detail display with formatted metadata and judging-start gating with track-capacity checks.
- Implemented the admin/coordinator account approval pipeline, including asynchronous approval emails and deduplication of approval notifications.
- Refined judge and mentor assignment logic, excluding admin/coordinator accounts from the assignment picker, and localized the AI Judge Assistant's UI to English.
- Fixed cross-cutting UX issues across the application — unified dashboard navigation, auth-aware landing CTAs, scroll-position reset on route change, and consistent event date formatting.
- Added unit and integration test coverage (Vitest) for track assignment, setup-gate logic, and track statistics helpers.

### Đào Hoàng Nhật — Backend Developer

- Bootstrapped the backend codebase, initializing the Spring Boot + Maven project architecture, initial entity models, and application configurations used throughout development.
- Designed and documented the relational database schema redesign for MySQL and SQL Server, including DDL structures, implementation plans, and seed data scenarios.
- Implemented core backend domain logic and CRUD operations for events, rounds, tracks, teams, assignments, participant join requests, and in-app notifications.
- Built the OTP-based password reset module end-to-end, covering backend token generation/validation, automated email delivery, and frontend UI flow.
- Architected the automated End-to-End (E2E) testing framework using Playwright, building multi-persona test scenarios and batch runners covering the full hackathon lifecycle.
- Authored comprehensive backend unit and integration test suites (JUnit 5, Mockito) covering core domain services, validation rules, and scoring flows.
- Configured Docker containerization, AWS EC2 preview deployments, OAuth2 redirect domain handling, and CI/CD test gates before release.

## Scope

This project delivers a full-stack web platform for organizing and running academic SEAL hackathon events end-to-end — from event/track/round setup and team registration through submission, judge scoring, ranking, and results — for use by event coordinators, mentors, judges, and competing teams.

## Problem Statement

Event management is currently handled manually, which leads to:

- Manual, error-prone team registration and track management.
- Scoring done through separate spreadsheets, requiring manual collection and re-entry of results.
- Limited communication channels between organizers, mentors, teams, and participants.
- No audit trail for scoring decisions or disqualifications, reducing transparency.
- No systematic support for analyzing consistency between judges.

## Goals

- Manage hackathon events per season.
- Manage multiple rounds within an event.
- Manage competition tracks/categories.
- Manage teams and team members.
- Manage mentors, internal judges, and guest judges.
- Support round-based submissions from teams.
- Support criteria-based scoring by judges.
- Automatically aggregate scores, compute rankings, and determine which teams advance.
- Record an audit trail of key actions for transparency.
- Export results as CSV/Excel.
- (Optional/RBL) Collect scoring data to analyze inter-rater reliability among judges.

## User Roles

| Role | Description |
|------|-------------|
| Team Member | Member of a competing team; can view events, schedules, notifications, and results. |
| Team Leader | Team representative; can create/manage the team, register the team for a track, submit entries, and track results. |
| Mentor | Provides guidance to teams within their assigned track(s). |
| Judge | Scores submissions for rounds/tracks they are assigned to; can be internal faculty or a guest judge. |
| Event Coordinator | Organizer/staff role; manages events, rounds, tracks, criteria, judge/mentor assignments, account approvals, submissions, rankings, and results. |
| Admin | Manages system accounts, permissions, and overall system configuration. |

## Tech Stack

**Frontend** (`front-end/src/seal-web`)
- React 18 + TypeScript
- Vite (dev server/build tool)
- React Router
- Tailwind CSS
- Radix UI / MUI components
- React Hook Form
- Recharts (dashboards/statistics)
- Vitest + Testing Library (unit/integration tests)

**Backend** (`back-end/src/seal-api`)
- Java 21
- Spring Boot 4 (Web MVC, Data JPA, Security, Mail)
- Spring Security with JWT authentication
- OAuth2 login (Google, GitHub)
- MySQL (via Spring Data JPA / Hibernate)
- springdoc-openapi (Swagger UI)
- Google Gemini API integration (AI Judge Assistant, optional)
- Maven (with the included Maven Wrapper)

**Database**
- MySQL 8 (schema is generated from JPA entities; `ddl-auto=update`)

**Platforms / Tools**

_TODO: e.g., GitHub Projects for task tracking, Figma for UI/UX design, Postman for API testing, deployment platform._

## Project Structure

```
seal-hackathon-system/
├── docs/
├── .github/workflows/
│
├── back-end/src/seal-api/
│   └── src/main/java/com/seal/hackathon/
│       ├── controller/
│       ├── service/
│       │   └── grouping/
│       ├── entity/
│       ├── repository/
│       ├── dto/
│       │   ├── request/
│       │   └── response/
│       ├── security/
│       │   └── oauth2/
│       ├── config/
│       │   └── seed/
│       ├── event/
│       ├── exception/
│       └── resources/
│   └── src/test/
│
└── front-end/src/seal-web/
    ├── public/
    └── src/
        ├── app/
        │   ├── routes/
        │   ├── layouts/
        │   └── providers/
        ├── features/
        │   ├── auth/
        │   ├── dashboard/
        │   │   └── dashboards/
        │   │       └── participant/
        │   │           ├── components/
        │   │           ├── screens/
        │   │           └── utils/
        │   ├── events/
        │   ├── scoring/
        │   ├── submissions/
        │   ├── teams/
        │   ├── tracks/
        │   ├── users/
        │   └── landing/
        ├── shared/
        │   ├── api/
        │   ├── components/
        │   ├── hooks/
        │   └── constants/
        ├── styles/
        ├── imports/
        └── test/
```

## Prerequisites

- Java 21 (JDK)
- Maven (or use the included `mvnw` / `mvnw.cmd` wrapper — no separate install required)
- Node.js 18+ and npm
- MySQL 8 running locally (or accessible via network)

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd seal-hackathon-system
```

### 2. Backend setup (`back-end/src/seal-api`)

1. Create a MySQL database user/credentials (the database itself, e.g. `seal_hackathon`, is created automatically on first run since `createDatabaseIfNotExist=true` is set).
2. Configure local secrets. Copy the example file and fill in what you need — every variable is commented with what it's for and what happens if you leave it blank:

   ```bash
   cp back-end/src/seal-api/.env.example back-end/src/seal-api/.env
   ```

   At minimum, set `DB_USERNAME`/`DB_PASSWORD` and `JWT_SECRET`. Everything else (OAuth2, Gemini AI, mail, GitHub token) is optional and only needed if you're using that feature.

3. Run the API (from `back-end/src/seal-api`):

   ```bash
   ./mvnw spring-boot:run
   ```

   On Windows:

   ```bash
   mvnw.cmd spring-boot:run
   ```

4. The API starts on `http://localhost:8080`.
5. API documentation (Swagger UI) is available at `http://localhost:8080/swagger-ui.html`.
6. Run backend tests:

   ```bash
   ./mvnw test
   ```

### 3. Frontend setup (`front-end/src/seal-web`)

1. Install dependencies:

   ```bash
   cd front-end/src/seal-web
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

   The app runs on `http://localhost:5173` by default and talks to the API at `http://localhost:8080`.

3. Build for production:

   ```bash
   npm run build
   ```

4. Run frontend tests:

   ```bash
   npm run test
   # or, in watch mode:
   npm run test:watch
   ```

## Core Demo Flow

1. Event Coordinator logs in.
2. Event Coordinator creates a hackathon event.
3. Event Coordinator creates tracks and rounds.
4. Event Coordinator defines a scoring criteria set.
5. A Team Leader registers an account and is approved.
6. Team Leader creates a team and adds members.
7. Team Leader registers the team for a track.
8. Team Leader submits an entry for a round.
9. Event Coordinator assigns judges.
10. Judges log in and score submissions.
11. The system computes scores and rankings.
12. Event Coordinator publishes results.
13. Teams view rankings and results.
14. Event Coordinator exports a CSV/Excel report.

## Documentation

- `docs/documents/ProjectRequirements.md` — full project requirements, roles, use cases, and scope.
- `docs/documents/seal_traceability_matrix.md` — requirements traceability matrix.
- `docs/report/` — engineering reports produced throughout development.

## License

This project was developed as part of the SWP391 course. No license has been declared; contact the project maintainers before reuse outside the course context.
