# 작업 인계

## 이전 내용 요약

- 문서 관리와 작업 인계·커밋·푸시 보고 방식을 정리했다. 세부 규칙은 `AGENTS.md`와 `docs/workflow.md`를 참조한다.

## 현재 진행 내용

- 목적지와 최대 소요 시간으로 경로를 찾고 정류장·역 근처 아파트의 매매·전세·월세 정보를 조회한다는 요구와 비용을 지불하지 않는 제약을 개요에 반영했다.
- 공식 자료를 조사했다. 국토부의 무료 [매매](https://www.data.go.kr/data/15126469/openapi.do)·[전월세](https://www.data.go.kr/data/15126474/openapi.do) API는 신고된 실거래 자료이며, 현재 매물을 제공하는 데이터로 간주하면 안 된다. 실거래 중심으로 시작하는 방안은 제안 단계다.
- Kakao는 [대중교통 경로 조회](https://developers.kakao.com/docs/ko/kakaomap/rest-api)를 제공한다. [쿼터 표](https://developers.kakao.com/docs/ko/getting-started/quota)와 [무과금 앱의 쿼터 및 임시 캐싱 금지에 대한 담당자 안내](https://devtalk.kakao.com/t/api-api/151980)가 있어 실제 앱 설정에 따른 한도를 확인해야 한다. 경로를 미리 수집·저장하는 방안은 전제로 삼지 않는다.
- [ODsay](https://lab.odsay.com/contact/contact)의 Basic은 일 30회, [TMAP 대중교통](https://transit.tmapmobility.com/)의 FREE는 경로 API 일 10회로 안내된다. 무료 무제한 서비스로 전제하지 않는다.
- 공개 교통 자료를 정적으로 배포하고 브라우저에서 목적지 방향으로 역탐색하는 방안을 제안했다. 기술 선택은 아직 확정하지 않았다.
- 다음 검토 사항: 실제 매물의 무료 제공처 확보 가능성, 지원 지역의 교통·아파트 좌표 자료 및 이용 조건, 시간 추정의 정확도, 경로 API의 브라우저·iframe 호출 가능 여부와 키 관리. API 키를 발급받아 호출 검증한 상태는 아니다.
