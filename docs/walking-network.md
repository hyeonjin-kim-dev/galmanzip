# 보행망 자료의 선택

사용자는 지도에서 직선으로 이어지는 도보 구간도 도로·인도를 따라 표시하도록 요청했다. 기존 KTDB·GBIS 버스 자료에는 일반 보행망이 없으므로 버스 선형을 도보 경로로 대신 사용하지 않는다. 비용 미지출·서버 미운영 결정을 유지하기 위해 공개 보행망을 미리 가공하고 필요한 지역을 브라우저에서 계산하는 방향을 선택했다.

원본은 [Geofabrik의 대한민국 OpenStreetMap 추출 파일](https://download.geofabrik.de/asia/south-korea.html)이다. [OSM 저작권 안내](https://www.openstreetmap.org/copyright)에 따라 기여자 출처와 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)을 명시하고 가공 보행망도 같은 라이선스로 공개한다. OSM 데이터 이용 허용과 공개 지도 타일·라우팅 서버의 무제한 이용은 별개다. 앱 검색마다 외부 길찾기·Overpass 서버를 호출하는 방식은 사용하지 않는다.

보행 가능 여부와 진행 방향은 [foot](https://wiki.openstreetmap.org/wiki/Key:foot), [oneway:foot](https://wiki.openstreetmap.org/wiki/Key:oneway:foot) 등 원본의 보행 제한을 따른다. 자동차 전용·보행 금지·사유 통행 제한을 무시하지 않으며, 입체 교차를 좌표가 가깝다는 이유로 연결하지 않는다. 실시간 공사·개방 시간·아파트 출입구·역사 내부 통로까지 정확하다는 보장은 없다. 자료가 없거나 연결을 확인하지 못한 구간을 임의의 직선·곡선으로 실제 보행 경로처럼 만들지 않는다.

자료 생성은 [준비 워크플로](../.github/workflows/walking-data.yml), 원본 해석은 [변환 코드](../scripts/build_walking.py)와 [검사](../tests/test_walking.py)를 기준으로 확인한다. 원본 기준 시각·해시는 가공 결과의 메타데이터를 따른다. 사용자 검색 기록과 공용 교통 자료의 보관은 구분한다.
