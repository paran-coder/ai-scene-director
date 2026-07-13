# AI용 내보내기 사용법

앱에서 `3 AI용 내보내기 → 내보낸 자료 사용법`을 누르면 이 내용을 제품 내부의 별도 페이지로 볼 수 있습니다.

## 가장 쉬운 사용법

1. `간단 내보내기`를 선택합니다.
2. `reference.png`를 다운로드합니다.
3. `final_prompt.txt`의 내용을 복사합니다.
4. 사용하는 이미지 생성 AI에 기준 이미지를 업로드합니다.
5. 프롬프트를 붙여넣고 생성을 실행합니다.

일반 이미지 생성에서는 다음 두 자료가 핵심입니다.

```text
reference.png
+
final_prompt.txt
```

## 이미지 생성용

다음 자료를 사용합니다.

```text
frames/reference.png
controls/pose.png
controls/depth.png
controls/entity_mask.png
prompts/final_prompt.txt
prompts/scene_prompt.txt
prompts/camera_prompt.txt
prompts/negative_prompt.txt
shot_manifest.json
```

### 적용 순서

- `reference.png`: 전체 구도와 인물·소품 배치를 위한 이미지 참조
- `final_prompt.txt`: 생성 AI의 최종 프롬프트
- `negative_prompt.txt`: 원하지 않는 결과를 줄이는 네거티브 프롬프트
- `pose.png`: 인물 자세 제어
- `depth.png`: 공간 깊이와 앞뒤 관계 제어
- `entity_mask.png`: 인페인팅·영역별 수정·합성

일반 이미지 AI에서는 `reference.png + final_prompt.txt`부터 사용하고, 제어 이미지를 지원하는 워크플로에서는 Pose·Depth·Mask를 추가합니다.

이미지용 `shot_manifest.json`의 파일 경로는 위 이미지용 구성과 일치하며 영상용 시작·종료 파일을 참조하지 않습니다.

## 영상 생성용

```text
frames/start_frame.png
frames/end_frame.png
controls/pose_start.png
controls/pose_end.png
controls/depth_start.png
controls/depth_end.png
controls/entity_mask_start.png
controls/entity_mask_end.png
prompts/final_prompt.txt
prompts/motion_prompt.txt
prompts/camera_prompt.txt
shot_manifest.json
```

### 적용 순서

- 시작 이미지만 받는 영상 AI: `start_frame.png`
- 시작·종료를 모두 받는 영상 AI: `start_frame.png`, `end_frame.png`
- 인물·소품 움직임: `motion_prompt.txt`
- 카메라 움직임: `camera_prompt.txt`
- 샷 길이와 구조 자동화: `shot_manifest.json`

영상용 `shot_manifest.json`은 시작·종료 프레임과 시작·종료 제어 이미지 경로를 참조합니다.

## 간단 내보내기

- 최종 프롬프트 복사
- 기준 이미지 한 장 다운로드
- 시작·종료 프레임 ZIP
- 전체 AI 자료 ZIP

## ComfyUI 연결 예시

```text
reference / start frame → Load Image
pose.png               → Pose ControlNet
depth.png              → Depth ControlNet
entity_mask.png        → Mask / Inpainting
final_prompt.txt        → Positive Prompt
negative_prompt.txt     → Negative Prompt
shot_manifest.json      → 자동화·워크플로 데이터
```

## 파일 사전

| 파일 | 의미 | 사용 위치 |
|---|---|---|
| `reference.png` | 전체 장면 기준 이미지 | 일반 이미지 AI |
| `final_prompt.txt` | 장면·인물·카메라 통합 프롬프트 | 이미지·영상 AI |
| `negative_prompt.txt` | 피해야 할 결과 | 네거티브 프롬프트 입력 |
| `pose.png` | 인물 자세 가이드 | Pose·ControlNet |
| `depth.png` | 공간 깊이와 거리 | Depth 제어 |
| `entity_mask.png` | 인물·소품 영역 분리 | 인페인팅·합성 |
| `start_frame.png` | 영상 시작 장면 | 이미지 기반 영상 AI |
| `end_frame.png` | 영상 종료 장면 | 시작·종료 프레임 영상 AI |
| `motion_prompt.txt` | 인물·소품 동작 | 영상 동작 설명 |
| `camera_prompt.txt` | 카메라 구도와 움직임 | 카메라 프롬프트 |
| `shot_manifest.json` | 샷 길이·객체·관계·카메라 구조 | ComfyUI·자동화 |

## 사용법 페이지 버튼의 의미

`이미지용 자료 만들기`와 `영상용 자료 만들기`는 외부 생성 서비스를 여는 버튼이 아닙니다. 각 생성 AI에 업로드할 ZIP 자료의 구성을 확인하고 다운로드하는 설정 화면을 엽니다.

영상용 설정에서는 `영상 AI 자료 ZIP 만들기`를 눌러 `start_frame.png`, `end_frame.png`, 동작·카메라 프롬프트와 제어 이미지를 다운로드합니다.

RC14에서는 ZIP 다운로드 직전에 파일 목록, CRC, PNG 기본 구조, 텍스트 인코딩, 매니페스트 모드와 파일 참조를 검사합니다. 검증에 실패한 자료는 다운로드하지 않고 오류 메시지를 표시합니다.
