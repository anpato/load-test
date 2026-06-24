package auth

import (
	"encoding/json"
	"errors"
)

type AuthType string

const (
	AuthNone    AuthType = "none"
	AuthCookie  AuthType = "cookie"
	AuthBearer  AuthType = "bearer"
	AuthHeaders AuthType = "headers"
)

type LoginStep struct {
	Selector string `json:"selector"`
	Action   string `json:"action"`
	Value    string `json:"value,omitempty"`
	WaitFor  string `json:"waitFor,omitempty"`
}

type CookieAuth struct {
	LoginURL string      `json:"loginUrl"`
	Steps    []LoginStep `json:"steps"`
}

type BearerAuth struct {
	Token       string            `json:"token,omitempty"`
	TokenURL    string            `json:"tokenUrl,omitempty"`
	TokenField  string            `json:"tokenField,omitempty"`
	Credentials map[string]string `json:"credentials,omitempty"`
}

type AuthConfig struct {
	Type    AuthType          `json:"type"`
	Cookie  *CookieAuth       `json:"cookie,omitempty"`
	Bearer  *BearerAuth       `json:"bearer,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

func Validate(cfg *AuthConfig) error {
	if cfg == nil {
		return errors.New("auth config is nil")
	}
	switch cfg.Type {
	case AuthNone:
		return nil
	case AuthCookie:
		if cfg.Cookie == nil {
			return errors.New("cookie auth requires a cookie config block")
		}
		if cfg.Cookie.LoginURL == "" {
			return errors.New("cookie auth requires login_url")
		}
		if len(cfg.Cookie.Steps) == 0 {
			return errors.New("cookie auth requires at least one login step")
		}
		return nil
	case AuthBearer:
		if cfg.Bearer == nil {
			return errors.New("bearer auth requires a bearer config block")
		}
		if cfg.Bearer.Token == "" && cfg.Bearer.TokenURL == "" {
			return errors.New("bearer auth requires either token or token_url")
		}
		return nil
	case AuthHeaders:
		if len(cfg.Headers) == 0 {
			return errors.New("headers auth requires at least one header")
		}
		return nil
	default:
		return errors.New("unknown auth type: " + string(cfg.Type))
	}
}

func ToJSON(cfg *AuthConfig) (string, error) {
	b, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
