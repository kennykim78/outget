# MASTER_PRD.md
# Academy Data Lab (학원데이터랩)
Version: 1.0
Status: MVP Planning
Document Type: Master Product Requirement Document
Target: Claude Code / Cursor / Engineering Team
Author: Founder
Last Updated: 2026-06-07

---

# 1. Product Overview

## 1.1 Product Name

### Korean
학원데이터랩 (가칭)

### English
Academy Data Lab

---

## 1.2 Product Definition

Academy Data Lab is a map-first, data-driven academy reputation intelligence platform for elementary and middle school parents in Seoul.

The platform helps parents make better educational decisions by transforming fragmented academy reputation signals into structured, understandable intelligence.

This is NOT:

- academy recommendation platform
- review-only platform
- advertisement-first platform

This IS:

> Education Reputation Intelligence Platform

---

## 1.3 Product Vision

### Mission

Help parents choose academies based on data rather than advertisements.

### Vision

Become the default educational intelligence platform for academy discovery in Seoul.

---

## 1.4 Core Value Proposition

Current Problem:

Parents must search through:

- Naver Blogs
- Naver Cafes
- Mom Communities
- Instagram
- Word of Mouth

to evaluate one academy.

This causes:

- Search fatigue
- Information asymmetry
- Ad manipulation risk
- Decision uncertainty

Academy Data Lab solves this by:

> converting reputation signals into decision intelligence.

---

# 2. Product Positioning

## 2.1 Positioning Statement

For parents of elementary and middle school students in Seoul,

Academy Data Lab is:

> a map-first educational intelligence platform

that helps compare academies using reputation signals, parent reviews, and decision-fit analysis.

Unlike:

- academy advertisement services
- cafe-based fragmented reviews

Academy Data Lab provides:

> structured decision intelligence.

---

## 2.2 Platform Principles

The product must always prioritize:

### Principle 1
Data First

Never show ads before useful data.

Priority:

```txt
Data
→ Reputation
→ Reviews
→ Promotion
```

---

### Principle 2
Decision Support

Do not simply expose information.

Always help decision-making.

Bad:

"OO Academy has high mentions"

Good:

"Recommended for Grade 5 math intensive learners"

---

### Principle 3
Map-first UX

The product is location-first.

Primary exploration method:

```txt
Map
→ Region
→ Academy
→ Intelligence
```

NOT:

```txt
Search
→ List
→ Random discovery
```

---

### Principle 4
Trust First

Transparency is mandatory.

Rules:

- sponsored content clearly labeled
- ranking manipulation prohibited
- no fake recommendation language

Forbidden wording:

❌ Best Academy

❌ #1 Academy

❌ Top Academy

Allowed wording:

✅ High Parent Interest

✅ Rising Trend

✅ High Middle School Fit

---

### Principle 5
Legal Safe Architecture

Do not become content scraper.

Allowed:

- metadata
- public signals
- reputation indicators
- links to original source

Forbidden:

- full content scraping
- mass reposting
- review copying

---

# 3. Product Scope

## 3.1 Geographic Scope

### Service Area

Seoul Metropolitan Area

Coverage:

All Seoul districts.

---

### Density Priority Region (MVP)

Focus regions:

1. Gangnam
2. Mokdong (Yangcheon)
3. Nowon

Reason:

High educational demand density.

---

## 3.2 Target Users

### Primary Users

Parents of:

- Elementary school students
- Middle school students

Age:

35~50

---

### Secondary Users

Academy owners (future B2B)

NOT MVP.

---

## 3.3 Student Range

Included:

```txt
Elementary
Grade 1~6

Middle School
Grade 1~3
```

Excluded in MVP:

```txt
Kindergarten

High school
```

Reason:

Too broad for MVP.

---

# 4. Problem Definition

## 4.1 Core User Problem

Parents currently experience:

### Search Fatigue

Example behavior:

```txt
Search:
"목동 영어학원 추천"

↓

Read blogs

↓

Search mom cafes

↓

Ask friends

↓

Visit academy

↓

Uncertainty remains
```

Average time investment:

Very high.

---

### Trust Problem

Parents struggle to identify:

```txt
Real review
vs
Advertisement
```

---

### Comparison Problem

Parents cannot compare:

- homework intensity
- teaching style
- school exam fit
- elementary fit
- middle school fit

using objective data.

---

## 4.2 Product Goal

Reduce academy selection time.

Current:

```txt
30~60 min
```

Target:

```txt
3~5 min
```

through structured intelligence.

---

# 5. User Personas

## Persona A

### Elementary Parent

Age:
38~45

Child:
Grade 4

Goal:

Math 선행

Pain Point:

Does not know which academy fits child.

Search behavior:

```txt
Naver
→ Mom Cafe
→ Reviews
→ Ask other moms
```

Need:

Simple recommendation logic.

---

## Persona B

### Middle School Parent

Child:
Middle School Grade 1

Goal:

내신 관리

Pain Point:

Unsure which academy improves grades.

Needs:

- homework intensity
- exam prep quality
- management level

---

# 6. Product Success Metrics

## North Star Metric

Monthly Decision Sessions

Definition:

User viewed academy intelligence and performed:

- compare
- bookmark
- external review click

---

## KPI

### Month 3

MAU:
3,000+

---

### Month 6

MAU:
10,000+

---

### Month 12

MAU:
50,000+

---

# 7. UX Philosophy

## 7.1 UX Tone

Style:

```txt
Naver DataLab
+
Premium Dashboard
+
Map-first intelligence
```

Not:

```txt
Overly emotional
Commercial landing page
Bright education ad style
```

---

## 7.2 Visual Tone

Keywords:

- clean
- objective
- trustworthy
- analytical

Preferred:

white space heavy.

Avoid:

aggressive banners.

---

## 7.3 UX Priorities

Priority order:

```txt
Map

↓

Academy Card

↓

Intelligence

↓

Reviews

↓

Promotion
```

---

# 8. Information Architecture

## Top Level Navigation

```txt
/home

/map

/search

/region

/academy

/report

/mypage
```

---

## Navigation Structure

### 1. Home

Purpose:

Discovery.

Contains:

- trending regions
- weekly education trends
- popular academies
- parent insights

---

### 2. Map (Primary Screen)

Main feature.

Purpose:

Academy exploration.

Contains:

- map
- filters
- academy pin
- card preview

---

### 3. Search

Intent search.

Examples:

```txt
Grade 5 Math

Middle School English

숙제 적은 학원

내신형 수학
```

---

### 4. Region Intelligence

Examples:

```txt
목동 초등 영어 리포트

강남 중등 수학 트렌드
```

---

### 5. Academy Detail

Core intelligence screen.

Contains:

- reputation
- fit score
- trends
- reviews
- map
- external review links

---

### 6. My Page

Contains:

- bookmarks
- recent viewed
- saved comparison

# 9. Sitemap

## 9.1 Full Route Structure

```txt
/

├── /home
│
├── /map
│   ├── ?region=
│   ├── ?subject=
│   ├── ?grade=
│   ├── ?radius=
│   └── ?filter=
│
├── /search
│   ├── ?query=
│   └── ?intent=
│
├── /region
│   └── /[district]
│       ├── /elementary
│       ├── /middle
│       ├── /math
│       ├── /english
│       └── /report
│
├── /academy
│   └── /[academyId]
│
├── /compare
│
├── /report
│   ├── /weekly
│   ├── /trend
│   └── /rising
│
├── /bookmark
│
├── /mypage
│
├── /login
│
└── /admin
```

---

# 10. Navigation System

## 10.1 Main Navigation

Desktop:

```txt
Logo

지도탐색
지역리포트
검색
비교
북마크

[로그인]
```

---

Mobile:

Bottom Navigation

```txt
홈
지도
검색
리포트
마이
```

Important:

Map must always remain accessible in 1 click.

---

## 10.2 Navigation Rules

Rule 1:

User should access academy detail in:

```txt
≤ 3 interactions
```

Rule 2:

Map state must persist.

Example:

User opens academy detail

↓

Back

↓

Same map position restored

Required:

Map state caching.

---

# 11. Primary User Journey

## Journey A

### Nearby Academy Discovery

```txt
Home

↓

Map

↓

Select Region

↓

Map pin visible

↓

Click academy

↓

Data Card Preview

↓

Academy Detail

↓

Compare

↓

Bookmark
```

Target Time:

```txt
< 5 min
```

---

## Journey B

### Parent Intent Search

Example:

```txt
"초5 수학 선행"
```

```txt
Search

↓

Intent Results

↓

Fit Intelligence

↓

Academy Compare

↓

External Reviews

↓

Decision
```

---

## Journey C

### Region Trend Discovery

```txt
Home

↓

Weekly Report

↓

목동 중등 수학 트렌드

↓

Rising Academies

↓

Academy Details
```

---

# 12. Page Architecture

## 12.1 Home Page

Route:

```txt
/
```

Purpose:

Discovery + SEO landing.

---

### Section Structure

#### Hero

Contains:

```txt
서울 학원 데이터를 한눈에

지도 기반 학원 탐색
```

Search bar.

---

#### Weekly Education Trends

Cards:

Examples:

```txt
강남 중등 수학 관심 상승

목동 영어 숙제관리형 증가
```

---

#### Popular Regions

Cards:

```txt
강남
목동
노원
송파
```

---

#### Parent Insights

Examples:

```txt
초5 부모들이 많이 보는 학원 유형
```

---

#### Rising Academies

Not ranking.

Allowed wording:

```txt
최근 관심 증가
```

Never:

```txt
1위
```

---

## 12.2 Map Page (Core Screen)

Route:

```txt
/map
```

Priority:

Highest priority screen.

This is the product center.

---

### Layout Structure

Desktop:

```txt
---------------------------------
| Left Filter | Map            |
| Panel       |                 |
|              Academy Pins     |
---------------------------------
```

Mobile:

```txt
----------------
Map Fullscreen
----------------
Bottom Sheet
----------------
```

---

### Left Filter Panel

Filters:

#### Region

```txt
강남
양천
노원
송파
```

---

#### Subject

```txt
Math
English
Science
Korean
Coding
```

---

#### Grade

```txt
초1~초6

중1~중3
```

---

#### Parent Goal

Very Important.

```txt
선행학습

내신관리

숙제 적음

관리형

시험대비
```

This powers:

Decision Intelligence.

---

#### Radius

```txt
500m
1km
2km
3km
```

Default:

```txt
2km
```

---

#### Reputation Filters

```txt
High Parent Interest

High Satisfaction

High Homework Management

Trending Academy
```

---

### Map Pins

Pin Type:

Dynamic.

Example:

```txt
Blue
Normal

Green
High Fit

Orange
Trending

Gray
Low Data
```

Pin clustering required.

Mandatory.

---

### Academy Preview Card

When pin clicked:

Right drawer appears.

Contains:

```txt
OO수학학원

초4~중2

관심도
↑ 18%

만족도
78

숙제강도
높음

초등 적합
높음

[상세 보기]
```

---

## 12.3 Academy Detail Page

Route:

```txt
/academy/[academyId]
```

Purpose:

Decision Intelligence.

NOT advertisement page.

---

### Layout

Desktop:

```txt
Header

Summary Card

Reputation Dashboard

Fit Intelligence

Map

Reviews

External Reviews

Compare CTA
```

---

## Section 1

### Academy Summary

Contains:

```txt
Name

Subject

Target Grade

Address

Distance

Basic info
```

---

## Section 2

### Reputation Dashboard

Key Metrics:

```txt
Interest Score

Satisfaction Score

Trend Score

Trust Score
```

Visualization:

Charts preferred.

---

## Section 3

### Decision Intelligence

Core Feature.

Purpose:

Answer:

```txt
"우리 아이에게 맞는가?"
```

---

#### Example

Recommended For:

```txt
Grade 5

Math intensive

Homework tolerance:
High
```

Not Recommended:

```txt
Low-homework preference
```

---

### Fit Categories

```txt
Elementary Fit

Middle School Fit

Exam Fit

Homework Fit

Management Fit
```

---

## Section 4

### Academy Characteristics

Generated tags.

Example:

```txt
관리형

숙제많음

선행강함

시험대비
```

---

## Section 5

### Parent Reviews

Structure:

```txt
Parent Type

Grade

Subject

Review
```

Example:

```txt
초5 학부모

수학

관리 꼼꼼함

숙제량 많음
```

---

### Review Rules

Required:

Review structured fields.

Do NOT allow:

Free-text only.

Reason:

Data quality.

---

## Section 6

### External Review

Purpose:

Trust.

Rule:

Never copy content.

Only:

Search intent links.

Example:

Button:

```txt
네이버 후기 보기
```

Search query:

```txt
"대치동 OO수학학원 후기"
```

---

## Section 7

### Similar Academy

Example:

```txt
Nearby

Same Style

Same Parent Goal
```

---

# 13. Compare Feature

Route:

```txt
/compare
```

Purpose:

Decision support.

Max compare:

```txt
3 academies
```

---

### Compare Table

Fields:

```txt
Interest

Satisfaction

Homework

Management

Elementary Fit

Middle Fit

Trend
```

Never show:

```txt
Best Academy
```

Only:

Relative data.

---

# 14. Component Architecture

## Design System

Must use:

```txt
shadcn/ui
```

---

## Component Hierarchy

```txt
components/

common/
layout/
map/
academy/
review/
search/
report/
compare/
auth/
dashboard/
```

---

### Core Components

#### AcademyCard

Reusable.

Props:

```ts
academy
score
trend
fit
```

---

#### AcademyPin

Map pin.

Variants:

```txt
normal

trending

high-fit

low-data
```

---

#### ReputationScoreCard

Displays:

```txt
interest

satisfaction

trust

trend
```

---

#### DecisionFitCard

Displays:

```txt
recommended_for

not_recommended_for
```

---

#### ReviewSummary

Displays:

```txt
structured review
```

---

#### RegionTrendCard

Displays:

```txt
region trend intelligence
```

---

# 15. State Management

Recommended:

```txt
Zustand
```

Reason:

Simple.

Fast.

Claude-friendly.

---

### Global State

```ts
user

mapState

filters

bookmarks

compareList
```

---

### Map State Example

Must persist:

```ts
{
  zoom,
  center,
  region,
  selectedAcademy,
  activeFilters
}
```

Required:

Restore state on navigation.

---

# 16. SEO Foundation

Critical.

Must be implemented from MVP.

---

## SEO Strategy

### Layer 1

Academy SEO

Example:

```txt
/academy/daechi-math-academy
```

---

### Layer 2

Intent SEO

Example:

```txt
/region/mokdong/elementary/math

/search?intent=초5수학선행
```

---

### Layer 3

Region Intelligence SEO

Example:

```txt
/region/mokdong/report
```

---

### Metadata Rules

Every page must include:

```ts
title

description

keywords

og image

json ld
```

---

### SSR Strategy

Use:

```txt
SSR + ISR hybrid
```

Reason:

SEO performance.

Dynamic freshness.