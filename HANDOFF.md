# 작업 인계

## 이전 내용 요약

- 첫 버전은 서울·경기도 아파트 실거래 정보를 제공하고, 현재 매물은 네이버 부동산 외부 링크로 연결한다. 백엔드 미운영·사용자 정보 비저장·비용 미지출 원칙을 유지한다.
- 기술 방향과 공식 자료 조사는 `docs/technical-decisions.md`, 작업 운영 규칙은 `AGENTS.md`와 `docs/workflow.md`를 참조한다.
- React 초기 화면과 GitHub Pages 배포를 준비했고 기존 작업 이력을 기본 브랜치에 연결했다. 초기 의존성 설치·타입 검사·프로덕션 빌드가 통과했다.
- 사용자가 첫 화면의 정상 표시를 확인했고, 에이전트의 `main` 푸시로 시작한 [자동 배포](https://github.com/hyeonjin-kim-dev/galmanzip/actions/runs/41193079431)도 빌드·게시 모두 성공했다. 이후에는 에이전트가 배포까지 진행하며 사용자의 반복 수동 실행을 요구하지 않는다.
- 전체 화면 Kakao 지도 연결을 준비했다. 타입 검사와 빌드, 실제 Chromium에서의 데스크톱·모바일·iframe 크기 대응 및 모의 SDK를 이용한 로딩·오류 처리를 검증했다. 실제 지도와 타일을 검증한 것은 아니며, 외부 설정 안내는 `docs/kakao-map-setup.md`를 참조한다.

## 현재 진행 내용

- 사용자가 Kakao 앱·GitHub 변수 등록을 완료했다고 알렸다. 준비해 둔 지도 변경 `4098545`를 `main`에 반영했다. 키 값을 문서나 인계 기록에 적지 않는다.
- [자동 배포 실행](https://github.com/hyeonjin-kim-dev/galmanzip/actions/runs/41197129729)에서 지도 키 존재 확인·타입 검사·빌드와 GitHub Pages 게시가 모두 성공했다. 사용자의 수동 실행은 필요하지 않았다.
- 배포 주소는 `https://hyeonjin-kim-dev.github.io/galmanzip/`이다. 외부 설정 완료 및 배포 결과를 `docs/kakao-map-setup.md`에 기록했다.
- 작업 환경의 제한된 네트워크 정책에 배포 사이트와 Kakao 호스트가 포함되어 있지 않다. 실제 SDK·타일의 브라우저 표시와 무료 쿼터 적용은 직접 확인하지 못했으므로 완료로 단정하지 않는다. 문제 보고가 오면 허용 도메인·키 종류·카카오맵 활성화 상태를 확인한다.
- 부동산 검색 기능은 아직 구현하지 않았다. 다음 기능의 검증 과제는 `docs/technical-decisions.md`를 참조한다.
