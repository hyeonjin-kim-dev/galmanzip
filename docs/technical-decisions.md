# 기술 방향과 데이터 조사

## 문서의 성격

2026년 10월 31일과 11월 1일의 공식 자료 조사 및 사용자 결정을 기록한다. 코드에서 확인할 수 있는 함수·구조·설정값은 옮겨 적지 않는다. 외부 서비스의 요금·이용 조건은 실제 도입 전에 원문에서 다시 확인한다.

## 확정된 방향과 이유

사용자는 서울·경기 아파트를 조회하고 현재 매물은 네이버 부동산 링크로 확인하는 방식에 동의했다. 실거래가 연결도 후속 목표로 유지한다. 비용 미지출·백엔드 미운영·사용자 정보 비저장은 [프로젝트 개요](project-overview.md)를 따른다.

가장 최근 결정은 **외부 길찾기 API 대신 서버 없는 알고리즘을 사용하고 환승 0회 경로를 반드시 우선하는 것**이다. 이전 자체 계산 금지와 카카오 전환 요청을 대체한다. 세부 요구의 배경은 [경로 검색 원칙](routing-policy.md)에 기록한다.

| 영역 | 선택 이유와 제약 |
| --- | --- |
| 정적 웹앱 | GitHub Pages에서 무료로 확인하고 향후 앱의 iframe에서도 같은 구현을 사용하기 위함 |
| 지도·장소 | 사용자가 선택한 Kakao 지도를 유지한다. 장소 검색으로 아파트 위치를 먼저 제공하고 실거래가의 수집·단지 연결을 기다리지 않기로 했다. 장소 검색은 전체 명부가 아니므로 누락 가능성이 있다. |
| 경로 자료 | 이미 전달받은 KTDB를 활용해 외부 경로 API의 호출량·인증·서버 제약을 피한다. 기준일·누락·재배포 근거는 [교통 자료 안내](search-data-setup.md)를 따른다. |
| 공개 자료 갱신 | 운영 백엔드 없이 수집·가공한 자료를 정적으로 제공한다. 공공데이터 인증키를 사용자 브라우저에 배포하지 않기 위함 |
| 외부 상세 확인 | 최신 운행과 매물은 공식 외부 서비스에서 확인한다. 확인하지 않은 네이버 개별 단지 식별자나 URL 규칙을 추측하지 않는다. |

## 데이터 조사 결과

| 자료 | 공식 출처 | 확인한 범위와 제약 |
| --- | --- | --- |
| 아파트 매매 실거래가 | [국토부 API](https://www.data.go.kr/data/15126469/openapi.do) | 무료. 지역과 계약 연월로 신고된 거래를 조회하며 현재 매물 자료가 아님 |
| 아파트 전세·월세 실거래가 | [국토부 API](https://www.data.go.kr/data/15126474/openapi.do) | 무료. 신고·확정일자 기반 실거래 자료이며 현재 매물 자료가 아님 |
| 공동주택 기본정보 | [국토부 API](https://www.data.go.kr/data/15058453/openapi.do) | 무료. K-apt 가입 단지 정보이며 서울·경기 모든 아파트의 좌표가 확보된 것으로 간주하지 않음 |
| 버스 정류장·노선 | [TAGO 정류소 API](https://www.data.go.kr/data/15098534/openapi.do), [TAGO 노선 API](https://www.data.go.kr/data/15098529/openapi.do) | 지원 도시별 범위가 다르므로 실제 노선과 시간 자료의 보완 여부를 확인해야 함 |
| 지하철 역간 시간 | [서울교통공사 자료](https://data.seoul.go.kr/dataList/OA-12034/A/1/datasetView.do) | 서울교통공사 1~8호선 자료이며 경기·타 운영사 철도망 전체가 아님 |
| 수도권 교통망 | [KTDB GTFS 공지](https://www.ktdb.go.kr/www/selectBbsNttView.do?bbsNo=2&key=45&nttNo=3831) | 사용자가 원본 전달을 마쳤다. 최신 실시간 시간표가 아닌 기준일 분석 자료임 |

아파트 주소·단지 식별자·좌표와 거래 정정·해제 내역을 정확히 연결하는지 검증해야 한다. 추가 자료를 정적으로 배포할 때는 출처의 저장·가공·재배포 조건을 별도로 확인한다.

## 외부 길찾기 API 검토를 마친 배경

아래는 채택하지 않은 대안의 조사 이력이다. 현재 구현의 설정 절차나 재승인 요구로 사용하지 않는다.

- 카카오모빌리티 제휴 `multimodal`과 일반 카카오맵 `publictraffic`은 별개 상품이다. 제휴 승인 제약은 [이전 검토](kakao-transit-setup.md)를 참조한다.
- [카카오맵 명세](https://developers.kakao.com/docs/ko/kakaomap/rest-api)와 [이용 정책](https://developers.kakao.com/docs/ko/kakaomap/common)을 검토했다. [쿼터 표](https://developers.kakao.com/docs/ko/getting-started/quota)의 일 1,000건과 [2026년 10월 6일 담당자 답변](https://devtalk.kakao.com/t/api-api/151980)의 유료 미설정 월 300만 건 적용 차이를 실제 앱에서 확정하지 못했다. 같은 답변은 경로 결과의 임시 캐싱도 불허했다. 사용자의 최신 결정으로 연동을 진행하지 않는다.
- [ODsay Basic](https://lab.odsay.com/contact/contact)은 일 30회, [TMAP FREE](https://transit.tmapmobility.com/)는 경로 API 일 10회로 안내돼 광역 아파트 자동 조회의 주된 대안으로 채택하지 않았다.
- [ODsay 접근성 영역 명세](https://lab.odsay.com/guide/releaseReference?platform=web)의 특정 지점에서 출발하는 영역은 목적지로 도착 가능한 출발 영역을 구하는 기능과 다르다.
- 정적 번들에 들어간 REST 키는 공개된다. 지도 JavaScript 키의 도메인 등록이 다른 REST 키를 보호한다고 가정하지 않는다. 서버리스 중계도 백엔드이므로 서버 미운영 원칙을 충족하는 대안으로 간주하지 않았다.

## OpenTripPlanner·R5 검토

사용자는 무료·무제한 호출 방법으로 OpenTripPlanner 검토를 요청했다. [OTP](https://www.opentripplanner.org/)는 OSM·GTFS를 사용하는 서버 측 Java 엔진이다. [기본 안내](https://docs.opentripplanner.org/en/latest/Basic-Tutorial/)와 [요구사항](https://docs.opentripplanner.org/en/latest/System-Requirements/)에 따라 그래프 생성과 서버 실행이 필요하다. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)에서 OTP 서버를 실행할 수는 없다.

[OTP 분석 안내](https://docs.opentripplanner.org/en/latest/Analysis/)에 따르면 OTP 2는 OTP 1의 등시간선·대량 분석 기능을 그대로 제공하지 않는다. 다대다 이동시간 계산에는 [R5](https://github.com/conveyal/r5)·[R5py](https://r5py.readthedocs.io/stable/user-guide/user-manual/travel-time-matrices.html)도 검토 대상이지만, 별도 실행 환경과 버전·자료 관리가 필요하다. 엔진이 오픈소스라는 사실이 무료 서버·무한 처리량을 보장하지 않는다.

무료 서버와 서버리스 중계도 검토했으나 사용자는 비용 미지출뿐 아니라 서버 미운영을 재확인했다. 따라서 현재는 이들 운영안을 채택하지 않는다. 과거의 상세 비교는 [당시 조사 기록](https://github.com/hyeonjin-kim-dev/galmanzip/blob/cfb9d47/docs/technical-decisions.md)에 남아 있다.

## 정확도와 후속 과제

- 이동 방향은 아파트에서 목적지로 가는 방향이다. 목적지에서 출발하는 경로로 대체하지 않는다.
- 사용자의 10분 오차 요구는 정확도 목표다. 검증 없이 보장하거나 최대 시간에 10분을 임의로 더하지 않는다.
- 최신 자료 갱신, 빠진 지역·분기·직통 노선 보완, 시간표·보행망 검증이 필요하다.
- 공공 아파트 좌표 명부를 확보해 넓은 범위의 반복 장소 조회를 줄이는 것이 후속 성능 과제다. 일부 결과·중단·조회 한도를 전체 아파트 검색 완료와 구분한다.
- 실거래가 수집·단지 연결과 네이버 개별 단지 연결은 아직 후속 과제다.
- 사용자 검색어·위치는 화면 메모리에서만 다룬다. Kakao 장소 검색으로 질의가 전달되는 외부 연동 특성은 자체 저장 여부와 구분한다.

자료를 새로 도입할 때 비밀키를 공개 번들에 넣지 않는다. 근거는 [CORS](https://developer.mozilla.org/ko/docs/Web/HTTP/Guides/CORS)와 [Vite 환경변수 노출](https://vite.dev/guide/env-and-mode)을 참조한다. 브라우저에서 허용되지 않는 API가 필요해지면 서버 없는 연동을 임의로 완료했다고 보고하지 않는다.
